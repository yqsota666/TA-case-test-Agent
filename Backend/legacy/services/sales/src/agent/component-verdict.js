import {reconcilePosition,validateResult} from './component-returns.js';
import {reject} from './store.js';

export async function evaluateCase(ctx,step) {
  if(ctx.facts.applicationMore||ctx.facts.confirmationMore)reject('业务事实读取截断，不能判定完成','ARCHIVE_BLOCKED',409);
  const others=ctx.components.filter(r=>r.step_key!==step.id&&r.kind!=='case.archive');
  if(others.some(r=>!['SUCCEEDED','SKIPPED'].includes(r.status)))reject('组件仍未完成或存在差异','ARCHIVE_BLOCKED',409);
  for(const s of ctx.plan.steps.filter(s=>s.kind==='result.validate')){
    const active=s.params.expectations.some(e=>ctx.components.find(r=>r.step_key===e.applicationStepId)?.status==='SUCCEEDED');
    if(!active)continue;
    if(ctx.components.find(r=>r.step_key===s.id)?.status!=='SUCCEEDED')reject('已执行申请的结果验证不能跳过','ARCHIVE_BLOCKED',409);
    if(!(await validateResult(ctx,s)).ok)reject('最新回传已不符合计划预期','RESULT_REVIEW',409);
  }
  for(const s of ctx.plan.steps.filter(s=>s.kind==='position.reconcile'&&ctx.components.find(r=>r.step_key===s.id)?.status==='SUCCEEDED'))
    if(!(await reconcilePosition(ctx,s)).ok)reject('份额核对存在差异','POSITION_REVIEW',409);
  const [[pending]]=await ctx.db.execute(`SELECT COUNT(*) AS n FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=?
    AND status NOT IN ('CONFIRMED','FAILED','CANCELED') AND NOT(file_type='03' AND business_code='070' AND EXISTS(
      SELECT 1 FROM file_records f JOIN delivery_events d ON d.workspace_id=f.workspace_id AND d.package_id=f.package_id
      WHERE f.workspace_id=applications.workspace_id AND f.chat_id=applications.chat_id AND f.run_id=applications.run_id
      AND f.application_id=applications.id AND d.event_type='DELIVERY_CONFIRMED'))`,ctx.keys);
  const [[unresolved]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM reconciliations WHERE workspace_id=? AND chat_id=? AND run_id=? AND status NOT IN ('MATCHED','SYNCED')",ctx.keys);
  if(Number(pending.n)||Number(unresolved.n)||ctx.facts.confirmations.some(c=>c.local_note))reject('存在待处理申请或未解决的回传/对账事项','ARCHIVE_BLOCKED',409);
  return {ok:true,verdict:'PASS'};
}
export async function archiveCase(ctx,step) {
  const result=await evaluateCase(ctx,step);
  const [[incoming]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='PENDING' AND source IN ('USER','RESUME')",ctx.keys);
  if(Number(incoming.n))reject('新的用户请求待处理','NEW_INPUT',409);
  await ctx.db.execute("UPDATE test_runs SET status='ARCHIVED' WHERE workspace_id=? AND chat_id=? AND id=?",ctx.keys);
  await ctx.db.execute("UPDATE agent_runs SET status='ARCHIVED',verdict='PASS',wait_json=NULL WHERE workspace_id=? AND chat_id=? AND run_id=?",ctx.keys);
  await ctx.db.execute("UPDATE agent_events SET status='DONE' WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='PENDING' AND source IN ('RETURN','DELIVERY')",ctx.keys);
  return {...result,archived:true};
}
