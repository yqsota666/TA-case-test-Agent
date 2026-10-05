import {canonical,reject} from './store.js';
import {ancestorLookup} from './component-plan.js';

export async function componentRows({db,keys}) {
  const [rows]=await db.execute('SELECT * FROM agent_components WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY step_key',keys);
  return rows;
}
export async function syncComponents(ctx,plan,version) {
  const ids=new Set(plan.steps.map(s=>s.id));
  for(const row of await componentRows(ctx))if(!ids.has(row.step_key)){
    await ctx.db.execute('DELETE FROM agent_component_transitions WHERE workspace_id=? AND chat_id=? AND run_id=? AND step_key=?',[...ctx.keys,row.step_key]);
    await ctx.db.execute('DELETE FROM agent_components WHERE workspace_id=? AND chat_id=? AND run_id=? AND step_key=?',[...ctx.keys,row.step_key]);
  }
  for(const s of plan.steps)await ctx.db.execute(`INSERT INTO agent_components(workspace_id,chat_id,run_id,step_key,kind,plan_version,definition_json,status)
    VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan_version=VALUES(plan_version),definition_json=VALUES(definition_json),kind=VALUES(kind)`,
    [...ctx.keys,s.id,s.kind,version,canonical(s),s.dependsOn.length?'BLOCKED':'READY']);
}
export async function transition(ctx,row,status,detail={}) {
  if(row.status===status&&canonical(row.output_json??null)===canonical(detail.output??row.output_json??null)
    &&canonical(row.wait_json??null)===canonical(detail.wait??null))return;
  const revision=Number(row.revision)+1;
  await ctx.db.execute(`UPDATE agent_components SET status=?,revision=?,output_json=?,wait_json=?,error_json=?,attempts=attempts+?
    WHERE workspace_id=? AND chat_id=? AND run_id=? AND step_key=? AND revision=?`,
    [status,revision,detail.output?canonical(detail.output):row.output_json?canonical(row.output_json):null,
      detail.wait?canonical(detail.wait):null,detail.error?canonical(detail.error):null,status==='RUNNING'?1:0,...ctx.keys,row.step_key,row.revision]);
  await ctx.db.execute(`INSERT INTO agent_component_transitions(workspace_id,chat_id,run_id,step_key,revision,from_status,to_status,detail_json)
    VALUES (?,?,?,?,?,?,?,?)`,[...ctx.keys,row.step_key,revision,row.status,status,canonical(detail)]);
  Object.assign(row,{status,revision,output_json:detail.output??row.output_json,wait_json:detail.wait??null,error_json:detail.error??null,
    attempts:Number(row.attempts)+(status==='RUNNING'?1:0)});
}

export function componentProgress(plan,rows) {
  const byId=new Map(rows.map(r=>[r.step_key,r]));
  return plan.steps.map(s=>{
    const r=byId.get(s.id);
    return {id:s.id,kind:s.kind,status:r?.status??'BLOCKED',revision:r?.revision??0,attempts:r?.attempts??0,
      eligible:r?.status==='READY',output:r?.output_json,wait:r?.wait_json,error:r?.error_json};
  });
}

export async function refreshComponents(ctx,plan) {
  const rows=await componentRows(ctx),byId=new Map(rows.map(r=>[r.step_key,r]));
  const parents=ancestorLookup(new Map(plan.steps.map(s=>[s.id,s])));
  for(const s of plan.steps.toSorted((a,b)=>parents(a.id).size-parents(b.id).size)){
    const r=byId.get(s.id);
    if(!r||!['BLOCKED','READY'].includes(r.status))continue;
    const deps=s.dependsOn.map(id=>byId.get(id));
    if(deps.some(d=>d.status==='SKIPPED')&&!s.allowSkippedDependencies){await transition(ctx,r,'SKIPPED',{output:{reason:'依赖分支未被选择'}});continue;}
    if(!deps.every(d=>d.status==='SUCCEEDED'||(s.allowSkippedDependencies&&d.status==='SKIPPED'))){
      await transition(ctx,r,'BLOCKED');continue;
    }
    if(s.when){
      const confirmation=byId.get(s.when.receiveStepId)?.output_json?.confirmations?.find(c=>c.stepId===s.when.applicationStepId);
      if(!confirmation)reject('条件所需确认不存在','PLAN_INVALID');
      if(confirmation.outcome!==s.when.outcome){await transition(ctx,r,'SKIPPED',{output:{reason:'回传结果未选择此分支'}});continue;}
    }
    await transition(ctx,r,'READY');
  }
  return rows;
}

export async function assertNoNewInput(ctx,eventId) {
  if(!eventId)return;
  const [[row]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? AND status='PENDING' AND source='USER'",[...ctx.keys,eventId]);
  if(Number(row.n))reject('新的用户请求待处理，暂停旧轮执行','NEW_INPUT',409);
}
