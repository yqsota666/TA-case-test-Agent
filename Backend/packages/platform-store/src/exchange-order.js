import { storeError } from './index.js';
import { createExchangeOrderGraph } from '../../case-agent/src/exchange-order-graph.js';
const json = v => typeof v === 'string' ? JSON.parse(v) : v;
export async function exchangeOrderContext(db, keys) {
  const [[locked]]=await db.execute(`SELECT version_number,plan_json FROM case_sop_versions
    WHERE workspace_id=? AND chat_id=? AND case_id=? AND status='LOCKED' ORDER BY version_number DESC LIMIT 1`,keys);
  const plan=locked && json(locked.plan_json).exchangePlan;
  if (!plan || plan.status !== 'READY') throw storeError('EXCHANGE_PLAN_REQUIRED',409,'此 Case 尚无已确认文件时序；请补充计划，历史 Case 不能猜测默认顺序');
  const [events]=await db.execute(`SELECT step_id AS stepId,condition_name AS \`condition\`,batch_id,parse_id
    FROM case_exchange_plan_events WHERE workspace_id=? AND chat_id=? AND case_id=? AND plan_version=?`,[...keys,locked.version_number]);
  return {plan,version:locked.version_number,events};
}
export async function checkExchangeOrder(db,keys,{stepId,direction,fileType,businessDate,batchId,parseId,condition}) {
  const context=await exchangeOrderContext(db,keys);
  let candidates=context.plan.steps.filter(s=>s.direction===direction && s.fileType===fileType);
  if (stepId) candidates=candidates.filter(s=>s.stepId===stepId);
  else if(direction==='RECEIVE') {
    const bound=candidates.filter(s=>s.dependsOn.some(d=>d.condition==='SENT' && context.events.some(e=>e.stepId===d.stepId && String(e.batch_id)===String(batchId))));
    if(bound.length) candidates=bound;
  }
  else candidates=candidates.filter(s=>!context.events.some(e=>e.stepId===s.stepId && String(e.batch_id)!==String(batchId)));
  if(candidates.length!==1) throw storeError('EXCHANGE_STEP_REQUIRED',409,'无法唯一确定计划步骤，请明确 exchangeStepId；不同轮次不能混用批次');
  const selected=candidates[0];
  const existing=context.events.find(e=>e.stepId===selected.stepId && e.condition===condition);
  if(existing && (String(existing.batch_id)!==String(batchId) || (condition!=='SENT' && String(existing.parse_id)!==String(parseId ?? 'NEW')))) {
    throw storeError('EXCHANGE_STEP_CONFLICT',409,'计划步骤已关联其他批次或回传包，不能覆盖');
  }
  const {checked}=await createExchangeOrderGraph().invoke({input:{plan:context.plan,stepId:selected.stepId,direction,fileType,businessDate,completed:context.events}});
  if(direction==='RECEIVE' && fileType!=='05' && !selected.dependsOn.some(d=>d.condition==='SENT' && context.events.some(e=>e.stepId===d.stepId && String(e.batch_id)===String(batchId)))) throw storeError('EXCHANGE_BATCH_MISMATCH',409,'回传批次不属于此轮次的发送步骤');
  return {...context,step:checked.step,existing};
}
export async function recordExchangeEvent(db,keys,checked,{condition,batchId,parseId=null}) {
  if(checked.existing) return;
  await db.execute(`INSERT INTO case_exchange_plan_events
    (workspace_id,chat_id,case_id,plan_version,step_id,condition_name,batch_id,parse_id) VALUES (?,?,?,?,?,?,?,?)`,
    [...keys,checked.version,checked.step.stepId,condition,batchId,parseId]);
}
