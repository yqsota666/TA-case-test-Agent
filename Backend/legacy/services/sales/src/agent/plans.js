import { planSchema } from './schemas.js';
import { canonical,parse,reject } from './store.js';
import { metadata,units } from '../platform/workflow-service.js';
import {validateComponentPlan} from './component-plan.js';

export const isoDate = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
export function validatePlan(input,previous,actions=[],components=[]) {
  const plan=parse(planSchema,input);
  if(plan.schemaVersion===2)return validateComponentPlan(plan,previous,components);
  if(previous?.schemaVersion===2)reject('组件计划不能降级为旧计划','PLAN_IMMUTABLE',409);
  const byId=new Map(plan.steps.map(s=>[s.id,s]));
  if(byId.size!==plan.steps.length) reject('计划步骤编号重复','PLAN_INVALID');
  const ancestry=ancestorLookup(byId);
  for(const step of plan.steps) validateStep(step,byId,ancestry);
  for(const action of actions.filter(a=>a.step_key && a.status==='DONE')) {
    const before=previous?.steps.find(s=>s.id===action.step_key),after=byId.get(action.step_key);
    if(!before || canonical(before)!==canonical(after)) reject('已经执行的步骤必须原样保留，可修改尚未执行的步骤','PLAN_IMMUTABLE',409);
  }
  return plan;
}

function validateStep(step,byId,ancestry) {
  if(step.dependsOn.some(id=>!byId.has(id) || id===step.id)) reject('计划依赖不存在或指向自身','PLAN_INVALID');
  const parents=ancestry(step.id);
  if(!['APPLICATION','VERIFY_POSITION'].includes(step.kind)) return;
  const p=step.params;
  if(Boolean(p.customerStepId)===Boolean(p.tradingAccountId)) reject('请选择客户创建步骤或现有交易账户，二者只能选一个','PLAN_INVALID');
  if(p.customerStepId) {
    const source=byId.get(p.customerStepId);
    if(source?.kind!=='CUSTOMERS' || p.customerIndex>=source.params.count || !parents.has(source.id)) reject('客户输出引用必须指向依赖中的客户创建步骤','PLAN_INVALID');
  }
  if(step.kind!=='APPLICATION') return;
  if(p.fileType==='01'?!metadata.accountBusinesses[p.businessCode]:!metadata.businesses[p.businessCode]) reject('计划业务类型不支持','PLAN_INVALID');
  if(p.fileType==='03' && !p.fundCode) reject('03 步骤必须指定基金','PLAN_INVALID');
  if(p.businessCode==='022' && (!p.amount || units(p.amount)<=0n)) reject('申购金额必须大于零','PLAN_INVALID');
  if(p.businessCode==='024' && (!p.volume || units(p.volume)<=0n)) reject('赎回份额必须大于零','PLAN_INVALID');
  if(p.negativeReason && (p.fileType!=='03' || step.expected.outcome!=='FAILURE')) reject('负向例外只用于明确预期失败的03','PLAN_INVALID');
  if(p.negativeReason==='NO_POSITION' && p.businessCode!=='024') reject('无持仓例外仅支持赎回','PLAN_INVALID');
}

function ancestorLookup(byId) {
  const cache=new Map();
  function lookup(id,path=new Set()) {
    if(path.has(id)) reject('计划依赖存在循环','PLAN_INVALID');
    if(cache.has(id))return cache.get(id);
    const next=new Set([...path,id]),result=new Set();
    for(const parent of byId.get(id)?.dependsOn??[]) {
      if(!byId.has(parent)) reject('计划依赖不存在','PLAN_INVALID');
      result.add(parent);
      for(const ancestor of lookup(parent,next)) result.add(ancestor);
    }
    cache.set(id,result);return result;
  }
  return lookup;
}

export function stepProgress(plan,actions,facts) {
  if(!plan) return [];
  const outputs=new Map(actions.filter(a=>a.step_key && a.status==='DONE').map(a=>[a.step_key,a.result_json]));
  const result=plan.steps.map(step=>{
    const output=outputs.get(step.id);
    if(!output) return {id:step.id,kind:step.kind,status:'PENDING'};
    if(step.kind!=='APPLICATION') return {id:step.id,kind:step.kind,status:'PASSED',output};
    const confirmations=facts.confirmations.filter(c=>String(c.application_id)===String(output.application.id));
    const final=confirmations.find(c=>c.outcome==='FAILURE' || (c.outcome==='SUCCESS' && (c.business_finish_flag==null || c.business_finish_flag==='1')));
    if(!final) return {id:step.id,kind:step.kind,status:'WAITING_RETURN',output};
    if(final.local_note) return {id:step.id,kind:step.kind,status:'REVIEW',output,reason:final.local_note};
    const matches=final.outcome===step.expected.outcome && (!step.expected.returnCodes.length || step.expected.returnCodes.includes(final.return_code));
    return {id:step.id,kind:step.kind,status:matches?'PASSED':'FAILED',output,
      businessOutcome:final.outcome,returnCode:final.return_code,confirmationDate:isoDate(final.confirmation_date)};
  });
  const states=new Map(result.map(s=>[s.id,s.status]));
  return result.map(row=>({...row,eligible:row.status==='PENDING' && plan.steps.find(s=>s.id===row.id).dependsOn.every(id=>states.get(id)==='PASSED')}));
}

export function resolveTradingAccount(step,actions,facts) {
  const p=step.params;
  let id=p.tradingAccountId;
  if(p.customerStepId) {
    const output=actions.find(a=>a.step_key===p.customerStepId && a.status==='DONE')?.result_json;
    id=output?.customers[p.customerIndex]?.tradingAccountId;
  }
  const account=facts.customers.find(c=>String(c.trading_account_id)===String(id));
  if(!account) reject('客户输出尚不存在或账户不属于当前 run','RECORD_NOT_FOUND',404);
  return account;
}

export function checkSnapshot(step,account,facts,progress) {
  const p=step.params;
  const sourceDates=progress.filter(s=>step.dependsOn.includes(s.id) && s.confirmationDate).map(s=>s.confirmationDate);
  const related=(facts.confirmationSources??[]).filter(c=>String(c.trading_account_id)===String(account.trading_account_id)
    && c.fund_code===p.fundCode && c.share_class===p.shareClass && c.branch_code===account.branch_code);
  const minimum=[p.snapshotDate??'',...sourceDates,...related.map(c=>isoDate(c.confirmation_date))].sort().at(-1);
  const snapshot=facts.snapshots.find(s=>String(s.trading_account_id)===String(account.trading_account_id)
    && s.fund_code===p.fundCode && s.share_class===p.shareClass && s.branch_code===account.branch_code);
  if(!snapshot || isoDate(snapshot.snapshot_date)<minimum) reject('需要相关业务完成后、对应账户和基金的05回传','WAITING_05',409);
  if(related.some(c=>isoDate(c.confirmation_date)===isoDate(snapshot.snapshot_date)
    && BigInt(c.file_record_id)>BigInt(snapshot.file_record_id)))
    reject('同日05早于后续04入库，请取得业务完成后的05再核对','WAITING_05',409);
  const position=facts.positions.find(s=>String(s.trading_account_id)===String(account.trading_account_id)
    && s.fund_code===p.fundCode && s.share_class===p.shareClass && s.branch_code===account.branch_code);
  if(units(snapshot.total_volume)!==units(p.totalVolume) || units(position?.total_volume??'0')!==units(p.totalVolume)) reject('05与销售持仓或计划预期不一致，需要人工核对；不会覆盖持仓','POSITION_REVIEW',409);
  if(facts.reconciliations.some(r=>String(r.snapshot_id)===String(snapshot.id) && !['MATCHED','SYNCED'].includes(r.status))) reject('05存在未解决的对账差异','POSITION_REVIEW',409);
  return {ok:true,snapshotId:String(snapshot.id),totalVolume:snapshot.total_volume,snapshotDate:isoDate(snapshot.snapshot_date)};
}
