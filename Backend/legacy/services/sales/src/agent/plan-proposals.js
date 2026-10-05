import crypto from 'node:crypto';
import {hash,reject} from './store.js';
import {validatePlan} from './plans.js';
import {readFacts} from './facts.js';

const confirmationText=id=>`确认计划 ${id}`;

export async function latestProposal(ctx) {
  const [[row]]=await ctx.db.execute(`SELECT proposal_id,base_version,plan_hash,plan_json,status,source_event_id,confirmation_event_id
    FROM agent_plan_proposals WHERE workspace_id=? AND chat_id=? AND run_id=?
    ORDER BY proposal_sequence DESC LIMIT 1`,ctx.keys);
  return row?{
    id:row.proposal_id,baseVersion:row.base_version,planHash:row.plan_hash,
    plan:row.plan_json,status:row.status,confirmationText:row.status==='PROPOSED'?confirmationText(row.proposal_id):null,
  }:null;
}

export async function discussionTurns(ctx) {
  const [[row]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND source='USER'",ctx.keys);
  return Number(row.n);
}

export async function proposePlan(ctx,{expectedVersion,plan},eventId,token,ids) {
  if(!eventId)reject('计划提案必须来自用户会话','USER_DISCUSSION_REQUIRED',409);
  const [[event]]=await ctx.db.execute(`SELECT source FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?`,[...ctx.keys,eventId]);
  if(event?.source!=='USER'||await discussionTurns(ctx)<2)reject('先与测试人员完成至少两轮讨论，再提交完整计划提案','USER_DISCUSSION_REQUIRED',409);
  if(ctx.runtime.plan_version!==expectedVersion)reject('计划已更新，请先读取当前版本','PLAN_CONFLICT',409);
  const {plan:previous,actions,components}=await readFacts(ctx,token,ids);
  const checked=validatePlan(plan,previous,actions,components),id=crypto.randomUUID();
  if(checked.schemaVersion!==2)reject('新提案必须使用细粒度组件计划','PLAN_INVALID',409);
  await ctx.db.execute("UPDATE agent_plan_proposals SET status='SUPERSEDED' WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='PROPOSED'",ctx.keys);
  await ctx.db.execute(`INSERT INTO agent_plan_proposals
    (workspace_id,chat_id,run_id,proposal_id,base_version,plan_json,plan_hash,source_event_id,status)
    VALUES (?,?,?,?,?,?,?,?,'PROPOSED')`,[...ctx.keys,id,expectedVersion,JSON.stringify(checked),hash(checked),eventId]);
  return {ok:true,stop:true,proposalId:id,baseVersion:expectedVersion,stepCount:checked.steps.length,
    confirmationText:confirmationText(id),message:'请向测试人员解释完整提案的业务路径、预期结果、外部回传和待确认事项；等待修改意见或逐字确认。当前没有保存正式计划，也没有执行。'};
}

export async function confirmedProposal(ctx,proposalId,eventId) {
  if(!eventId)reject('正式计划需要用户确认','PLAN_CONFIRMATION_REQUIRED',409);
  const [[event]]=await ctx.db.execute(`SELECT source,payload_json FROM agent_events
    WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?`,[...ctx.keys,eventId]);
  if(event?.source!=='USER'||event.payload_json?.content?.trim()!==confirmationText(proposalId))
    reject('请测试人员在新的消息中逐字发送提案的确认口令','PLAN_CONFIRMATION_REQUIRED',409);
  const [[proposal]]=await ctx.db.execute(`SELECT base_version,plan_json,source_event_id,status FROM agent_plan_proposals
    WHERE workspace_id=? AND chat_id=? AND run_id=? AND proposal_id=? FOR UPDATE`,[...ctx.keys,proposalId]);
  if(!proposal||proposal.status!=='PROPOSED'||BigInt(proposal.source_event_id)>=BigInt(eventId))
    reject('提案不存在、已失效或尚未经用户审阅','PLAN_PROPOSAL_STALE',409);
  const [[intervening]]=await ctx.db.execute(`SELECT COUNT(*) AS n FROM agent_events
    WHERE workspace_id=? AND chat_id=? AND run_id=? AND source='USER' AND id>? AND id<?`,[...ctx.keys,proposal.source_event_id,eventId]);
  if(Number(intervening.n))reject('提案后已有新的讨论，请根据反馈重新提交提案','PLAN_PROPOSAL_STALE',409);
  if(ctx.runtime.plan_version!==proposal.base_version)reject('提案基于旧计划版本，请重新讨论','PLAN_CONFLICT',409);
  return {proposal,confirmationEventId:eventId};
}

export async function markProposalConfirmed(ctx,proposalId,eventId) {
  await ctx.db.execute(`UPDATE agent_plan_proposals SET status='CONFIRMED',confirmation_event_id=?
    WHERE workspace_id=? AND chat_id=? AND run_id=? AND proposal_id=? AND status='PROPOSED'`,
  [eventId,...ctx.keys,proposalId]);
}
