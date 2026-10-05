import {applicationFields} from './capabilities.js';
import {units} from '../platform/workflow-service.js';
import {reject} from './store.js';

export const componentOutput=(ctx,id)=>{
  const row=ctx.components.find(r=>r.step_key===id);
  if(row?.status!=='SUCCEEDED'||!row.output_json)reject('依赖输出尚不存在：'+id,'DEPENDENCY_NOT_READY',409);
  return row.output_json;
};
export async function componentAccount(ctx,id) {
  const output=componentOutput(ctx,id);
  const account=ctx.facts.customers.find(c=>String(c.trading_account_id)===String(output.tradingAccountId));
  if(!account)reject('账户不属于本run或事实读取已截断','RECORD_NOT_FOUND',404);
  return account;
}

export async function defineCustomer(ctx,step) {
  const result=await ctx.workflow.defineCustomer(ctx.token,ctx.ids,step.params);
  return {ok:true,customerId:result.id,customerPublicId:result.publicId};
}
export async function defineAccount(ctx,step) {
  const customer=componentOutput(ctx,step.params.customerStepId);
  const account=await ctx.workflow.defineAccount(ctx.token,ctx.ids,customer.customerPublicId,{branchCode:step.params.branchCode});
  return {ok:true,tradingAccountId:account.id,transactionAccountNo:account.transactionAccountNo,customerId:customer.customerId};
}
export async function defineFund(ctx,step) {
  await ctx.workflow.addFund(ctx.token,ctx.ids,step.params);
  return {ok:true,...step.params};
}
export async function validateData(ctx,step) {
  for(const id of step.params.sourceStepIds){
    const output=componentOutput(ctx,id),source=ctx.plan.steps.find(s=>s.id===id);
    if(source.kind==='customer.define'){
      const [[customer]]=await ctx.db.execute('SELECT id FROM test_customers WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...ctx.keys,output.customerId]);
      if(!customer)reject('客户资料缺失','RECORD_NOT_FOUND',404);
    }else if(source.kind==='account.define')await componentAccount(ctx,id);
    else {
      const fund=ctx.facts.funds.find(f=>f.fund_code===output.fundCode&&f.share_class===output.shareClass);
      const [whole,fraction='']=output.nav.split('.');
      if(!fund||fund.fund_name!==output.fundName||String(fund.nav)!==`${BigInt(whole)}.${fraction.padEnd(8,'0')}`)reject('基金定义与实际数据不一致','DATA_REVIEW',409);
    }
  }
  return {ok:true,validatedSteps:step.params.sourceStepIds};
}

export async function prepareApplication(ctx,step) {
  const p=step.params,account=await componentAccount(ctx,p.accountStepId),fields=applicationFields(p);
  for(const [name,b]of Object.entries(p.fieldBindings)){
    const output=componentOutput(ctx,b.stepId);
    const value=b.output==='appNo'?output.application?.appNo:b.output==='transactionAccountNo'?output.transactionAccountNo:
      output.confirmations?.length===1?output.confirmations[0].taSerialNo:null;
    if(!value)reject('绑定输出缺失或有多个确认，请使用单申请接收组件：'+name,'BINDING_INVALID',409);
    fields[name]=value;
  }
  await validateNegative(ctx,p,account);
  const application=await ctx.workflow.createApplication(ctx.token,ctx.ids,{tradingAccountId:String(account.trading_account_id),
    fileType:p.fileType,businessCode:p.businessCode,businessDate:p.businessDate,testMode:p.negativeReason?'NEGATIVE':'NORMAL',
    ...(p.amount?{applicationAmount:p.amount}:{}),...(p.volume?{applicationVolume:p.volume}:{}),fields,expectedResult:{agentStepId:step.id}});
  return {ok:true,application:{id:application.id,appNo:application.appNo,fileType:p.fileType,businessCode:p.businessCode,
    tradingAccountId:String(account.trading_account_id)}};
}

async function validateNegative(ctx,p,account) {
  if(!p.negativeReason)return;
  if(p.negativeReason==='NO_TA_ACCOUNT'){
    if(account.ta_account_no)reject('无TA账户负向条件不成立','NEGATIVE_CONDITION',409);
    return;
  }
  if(!account.ta_account_no||account.account_status!=='ACTIVE')reject('无持仓测试需要成功开户的账户','ACCOUNT_NOT_CONFIRMED',409);
  const [[position]]=await ctx.db.execute('SELECT COALESCE(SUM(total_volume),0) AS total FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=? AND fund_code=? AND share_class=?',
    [...ctx.keys,account.trading_account_id,p.fundCode,p.shareClass]);
  if(units(position.total)!==0n)reject('无持仓负向条件不成立','NEGATIVE_CONDITION',409);
}

export async function generateFile(ctx,step) {
  const applicationIds=step.params.applicationStepIds.map(id=>componentOutput(ctx,id).application.id);
  const pack=await ctx.workflow.generate(ctx.token,ctx.ids,{applicationIds});
  return {ok:true,packageId:pack.publicId,files:pack.files,applicationIds,
    downloadUrl:`/api/chats/${ctx.ids.chatPublicId}/runs/${ctx.ids.runPublicId}/packages/${pack.publicId}/download`};
}
export async function waitDelivery(ctx,step) {
  const file=componentOutput(ctx,step.params.fileStepId);
  const [[evidence]]=await ctx.db.execute(`SELECT COUNT(*) AS n FROM delivery_events d JOIN exchange_packages p
    ON p.workspace_id=d.workspace_id AND p.id=d.package_id WHERE p.workspace_id=? AND p.public_id=? AND d.event_type='DELIVERY_CONFIRMED'`,
    [ctx.keys[0],file.packageId]);
  if(Number(evidence.n))return {ok:true,packageId:file.packageId,delivered:true};
  return {ok:true,waiting:true,wait:{category:'DELIVERY',reason:'需要操作人员确认实际送测',packageId:file.packageId,downloadUrl:file.downloadUrl}};
}
