import { storeError } from './index.js';
import { createExchangeOrderGraph } from '../../case-agent/src/exchange-order-graph.js';
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
export async function exchangeOrderContext(db, keys, write = true) {
  const [[locked]] = await db.execute(`SELECT version_number,plan_json FROM case_sop_versions
    WHERE workspace_id=? AND chat_id=? AND case_id=? AND status='LOCKED' ORDER BY version_number DESC LIMIT 1${write ? ' FOR UPDATE' : ''}`, keys);
  const plan = locked && json(locked.plan_json).exchangePlan;
  if (!plan || plan.status !== 'READY') throw storeError('EXCHANGE_PLAN_REQUIRED', 409,
    '此 Case 尚无已确认文件时序；请通过时序补充确认入口明确计划和现有文件映射');
  const scope = [...keys, locked.version_number];
  const [events] = await db.execute(`SELECT step_id AS stepId,condition_name AS \`condition\`,batch_id,parse_id
    FROM case_exchange_plan_events WHERE workspace_id=? AND chat_id=? AND case_id=? AND plan_version=?${write ? ' FOR UPDATE' : ''}`, scope);
  const [receipts] = await db.execute(`SELECT r.step_id AS stepId,b.batch_id,r.parse_id FROM case_exchange_plan_receipts r
    JOIN case_exchange_plan_bindings b ON b.workspace_id=r.workspace_id AND b.chat_id=r.chat_id
      AND b.case_id=r.case_id AND b.plan_version=r.plan_version AND b.step_id=r.step_id
    WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? AND r.plan_version=?${write ? ' FOR UPDATE' : ''}`, scope);
  const [bindings] = await db.execute(`SELECT step_id AS stepId,batch_id,file_type FROM case_exchange_plan_bindings
    WHERE workspace_id=? AND chat_id=? AND case_id=? AND plan_version=?${write ? ' FOR UPDATE' : ''}`, scope);
  const [holdingsReceipts] = await db.execute(`SELECT step_id AS stepId,CAST(parse_id AS CHAR) AS holdingsParseId
    FROM case_holdings_plan_receipts WHERE workspace_id=? AND chat_id=? AND case_id=? AND plan_version=?${write ? ' FOR UPDATE' : ''}`,scope);
  return { plan, version: locked.version_number, bindings,
    events: [...events, ...holdingsReceipts.map(row=>({...row,condition:'PARSED'})), ...receipts.map(receipt => ({ ...receipt, condition: 'PARSED' }))] };
}
export async function checkExchangeOrder(db, keys, {stepId,direction,fileType,businessDate,batchId,parseId,condition}) {
  const context = await exchangeOrderContext(db, keys);
  let candidates = context.plan.steps.filter(step => step.direction === direction && step.fileType === fileType);
  if (stepId) candidates = candidates.filter(step => step.stepId === stepId);
  else if (context.bindings.some(binding=>candidates.some(step=>step.stepId===binding.stepId) && String(binding.batch_id)===String(batchId))) {
    candidates=candidates.filter(step=>context.bindings.some(binding=>binding.stepId===step.stepId && String(binding.batch_id)===String(batchId)));
  } else if (direction === 'RECEIVE') {
    const bound = candidates.filter(step => step.dependsOn.some(dep => dep.condition === 'SENT' &&
      context.events.some(event => event.stepId === dep.stepId && String(event.batch_id) === String(batchId))));
    if (bound.length) candidates = bound;
  } else candidates = candidates.filter(step => !context.events.some(event =>
    event.stepId === step.stepId && String(event.batch_id) !== String(batchId)) && !context.bindings.some(binding=>binding.stepId===step.stepId && String(binding.batch_id)!==String(batchId)));
  if (candidates.length !== 1) throw storeError('EXCHANGE_STEP_REQUIRED', 409,
    '无法唯一确定计划步骤，请明确 exchangeStepId；不同轮次不能混用批次');
  const selected = candidates[0];
  if(context.bindings.some(item=>item.stepId!==selected.stepId && String(item.batch_id)===String(batchId) && item.file_type===fileType)) throw storeError('EXCHANGE_BATCH_ALREADY_BOUND',409,'同批同类型已经对应另一个计划步骤，不能把一次发送当作多轮完成');
  const registeredBinding = context.bindings.find(item => item.stepId === selected.stepId);
  const binding = registeredBinding ??
    context.events.find(event => event.stepId === selected.stepId);
  if (binding && String(binding.batch_id) !== String(batchId)) throw storeError('EXCHANGE_STEP_CONFLICT',409,
    '计划步骤已关联其他批次，不能覆盖轮次');
  const existing = context.events.find(event => event.stepId === selected.stepId && event.condition === condition &&
    (condition !== 'PARSED' || String(event.parse_id) === String(parseId)));
  const { checked } = await createExchangeOrderGraph().invoke({ input: { plan: context.plan,
    stepId:selected.stepId,direction,fileType,businessDate,completed:context.events } });
  if (direction === 'RECEIVE' && fileType !== '05' && !selected.dependsOn.some(dep => dep.condition === 'SENT' &&
    context.events.some(event => event.stepId === dep.stepId && String(event.batch_id) === String(batchId)))) {
    throw storeError('EXCHANGE_BATCH_MISMATCH',409,'回传批次不属于此轮次的发送步骤');
  }
  return {...context,step:checked.step,existing,binding,registeredBinding};
}
export async function recordExchangeEvent(db, keys, checked, {condition,batchId,parseId=null}) {
  if (!checked.registeredBinding) await db.execute(`INSERT INTO case_exchange_plan_bindings
    (workspace_id,chat_id,case_id,plan_version,step_id,batch_id,file_type) VALUES (?,?,?,?,?,?,?)`,
    [...keys,checked.version,checked.step.stepId,batchId,checked.step.fileType]);
  if (checked.existing) return;
  if (condition === 'PARSED') {
    await db.execute(`INSERT INTO case_exchange_plan_receipts
      (workspace_id,chat_id,case_id,plan_version,step_id,parse_id) VALUES (?,?,?,?,?,?)`,
      [...keys,checked.version,checked.step.stepId,parseId]);
  } else await db.execute(`INSERT INTO case_exchange_plan_events
    (workspace_id,chat_id,case_id,plan_version,step_id,condition_name,batch_id,parse_id) VALUES (?,?,?,?,?,?,?,?)`,
    [...keys,checked.version,checked.step.stepId,condition,batchId,parseId]);
}
