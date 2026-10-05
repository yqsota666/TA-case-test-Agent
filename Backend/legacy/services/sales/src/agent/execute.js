import { readFacts } from './facts.js';
import { resolveTradingAccount,checkSnapshot } from './plans.js';
import { reject } from './store.js';
import { units } from '../platform/workflow-service.js';

export async function executePlannedStep(context,{token,ids,stepId}) {
  const {facts,plan,actions,progress}=await readFacts(context,token,ids);
  const step=plan?.steps.find(s=>s.id===stepId),state=progress.find(s=>s.id===stepId);
  if(!step) reject('步骤不存在','STEP_NOT_FOUND',404);
  if(!state.eligible) reject('步骤尚不满足依赖，或已经执行，请读取当前进度','DEPENDENCY_NOT_READY',409);
  const {workflow}=context;
  if(step.kind==='CUSTOMERS') {
    const result=await workflow.addCustomers(token,ids,step.params);
    // addCustomers combines customer and trading output; resolve by customer public IDs.
    const publicIds=result.created.map(c=>c.publicId);
    const [customers]=await context.db.execute(`SELECT c.id,c.investor_name,t.id AS trading_account_id FROM test_customers c
      JOIN trading_accounts t ON t.workspace_id=c.workspace_id AND t.chat_id=c.chat_id AND t.run_id=c.run_id AND t.customer_id=c.id
      WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.public_id IN (${publicIds.map(()=>'?').join(',')}) ORDER BY c.id`,[...context.keys,...publicIds]);
    if(customers.length!==step.params.count) throw new Error('Created customer outputs could not be resolved');
    return {ok:true,customers:customers.map(c=>({customerId:String(c.id),tradingAccountId:String(c.trading_account_id),name:c.investor_name}))};
  }
  if(step.kind==='FUND') {
    await workflow.addFund(token,ids,step.params);
    return {ok:true,fundCode:step.params.fundCode,shareClass:step.params.shareClass};
  }
  const account=resolveTradingAccount(step,actions,facts);
  if(step.kind==='VERIFY_POSITION') return checkSnapshot(step,account,facts,progress);
  await validateNegative(context,step,account);
  const p=step.params,fields={...p.fields};
  if(p.fileType==='03') Object.assign(fields,{FundCode:p.fundCode,ShareClass:p.shareClass});
  if(p.businessCode==='022') Object.assign(fields,{CurrencyType:fields.CurrencyType??'156',ChargeType:fields.ChargeType??'0'});
  if(p.businessCode==='024') Object.assign(fields,{LargeRedemptionFlag:fields.LargeRedemptionFlag??'0',ChargeType:fields.ChargeType??'0'});
  const application=await workflow.createApplication(token,ids,{tradingAccountId:String(account.trading_account_id),
    fileType:p.fileType,businessCode:p.businessCode,businessDate:p.businessDate,
    testMode:p.negativeReason?'NEGATIVE':'NORMAL',...(p.amount?{applicationAmount:p.amount}:{}),
    ...(p.volume?{applicationVolume:p.volume}:{}),fields,expectedResult:{agentStepId:step.id,...step.expected}});
  const pack=await workflow.generate(token,ids,{applicationIds:[application.id]});
  await context.db.execute('UPDATE agent_runs SET wait_json=NULL WHERE workspace_id=? AND chat_id=? AND run_id=?',context.keys);
  return {ok:true,application:{id:String(application.id),appNo:application.appNo,fileType:p.fileType,businessCode:p.businessCode},
    packageId:pack.publicId,files:pack.files,downloadUrl:`/api/chats/${ids.chatPublicId}/runs/${ids.runPublicId}/packages/${pack.publicId}/download`,
    nextRequirement:p.fileType==='01'?'人工送测01，等待02':'人工送测03，等待04'};
}

async function validateNegative(context,step,account) {
  const p=step.params;
  if(!p.negativeReason) return;
  if(p.negativeReason==='NO_TA_ACCOUNT') {
    if(account.ta_account_no) reject('当前账户已经开户，无TA账号负向条件不成立','NEGATIVE_CONDITION',409);
    if(p.businessCode!=='022') reject('无TA账号负向模式当前仅支持申购','NEGATIVE_CONDITION');
  } else {
    if(!account.ta_account_no || account.account_status!=='ACTIVE') reject('无持仓负向测试仍需要成功开户的有效账户','ACCOUNT_NOT_CONFIRMED',409);
    const [[holding]]=await context.db.execute('SELECT COALESCE(SUM(total_volume),0) AS total FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=? AND fund_code=? AND share_class=?',
      [...context.keys,account.trading_account_id,p.fundCode,p.shareClass]);
    if(units(holding.total)!==0n) reject('当前账户具有持仓，无持仓负向条件不成立','NEGATIVE_CONDITION',409);
  }
}
