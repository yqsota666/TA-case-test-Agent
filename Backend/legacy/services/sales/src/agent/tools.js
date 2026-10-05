import { tool } from 'ai';
import { createAgentStore,canonical,hash,parse,reject } from './store.js';
import { savePlanSchema,finalizePlanSchema,executeStepSchema,executePlanSchema,emptySchema,packageSchema,waitSchema,notesSchema,rulesSchema } from './schemas.js';
import { readFacts,modelFacts } from './facts.js';
import { validatePlan,checkSnapshot,resolveTradingAccount } from './plans.js';
import { executePlannedStep } from './execute.js';
import { metadata } from '../platform/workflow-service.js';
import {createComponentService} from './components.js';
import {createComponentGraph} from './component-graph.js';
import {syncComponents} from './component-state.js';
import {capabilityCatalog} from './capabilities.js';
import {archiveCase} from './component-verdict.js';
import {proposePlan,confirmedProposal,markProposalConfirmed,latestProposal,discussionTurns} from './plan-proposals.js';
import {fieldsForFile} from '../../../../packages/platform-protocol/src/index.js';

const contracts={
  get_case_state:[emptySchema,'读取当前case/run的真实业务事实、计划版本、步骤状态、等待原因和文件下载地址。每轮首先调用。'],
  get_business_rules:[rulesSchema,'查询支持的01/03业务。指定fileType和businessCode可获得该业务的必填字段。不能把模拟目标份额作为真实持仓。'],
  propose_plan:[savePlanSchema,'多轮讨论后提交完整大plan供测试人员审阅。只生成提案，不成为正式计划，也不执行。收到修改意见后重新提案。'],
  finalize_plan:[finalizePlanSchema,'仅在测试人员另发一条与提案确认口令完全一致的消息后，将该提案转为正式计划。本轮不会执行。'],
  save_plan:[savePlanSchema,'旧计划兼容工具。新组件计划必须先propose_plan并取得测试人员逐字确认，再用finalize_plan；不能直接保存。'],
  execute_plan:[executePlanSchema,'启动或恢复已经保存的完整组件plan。LangGraph执行当前可推进的全部组件；各分支独立等待02/04/05或人工交付。用户只讨论时不能调用。'],
  execute_step:[executeStepSchema,'执行一个满足依赖的计划步骤。新计划优先使用execute_plan统一推进；旧APPLICATION仅用于历史兼容。'],
  inspect_return_package:[packageSchema,'检查已上传回传包中仅属于本run的02/04/05记录。原始回传由操作人员上传，Agent不能制造TA确认。'],
  remember_case_notes:[notesSchema,'保存本run的目标或用户约束摘要。摘要不代替真实账户、持仓或回传。'],
  wait_for_event:[waitSchema,'保存等待原因，停止当前轮，给出人工交付及回传提示。用于缺参数、人工送测、02/04/05回传或人工核对。'],
  evaluate_and_archive:[emptySchema,'由后端核对全部预期、待处理申请和对账状态，通过后归档。预期TA业务失败可以测试通过。'],
};
export const agentToolDefinitions=Object.fromEntries(Object.entries(contracts).map(([name,[inputSchema,description]])=>[name,tool({inputSchema,description})]));

export function createAgentTools({transaction,authenticate,token,ids,leaseToken,allowPlanChanges=true,eventId,checkpointer,threadId}) {
  const store=createAgentStore({transaction,authenticate});
  const components=createComponentService({transaction,authenticate,token,ids,leaseToken,eventId});
  const componentGraph=checkpointer?createComponentGraph({components,checkpointer,threadId}):null;
  async function dispatch(call) {
    try {
      const contract=contracts[call.toolName];
      if(!contract) reject('工具不存在','TOOL_NOT_FOUND');
      const input=parse(contract[0],call.input);
      if(!allowPlanChanges && ['propose_plan','finalize_plan','save_plan','remember_case_notes'].includes(call.toolName))
        return {ok:false,code:'USER_PLAN_REQUIRED',message:'回传是事实数据，不能修改用户目标或约束；需要调整计划时请向操作人员说明并等待用户请求'};
      if(call.toolName==='get_business_rules') return businessRules(input);
      if(call.toolName==='get_case_state') return await store.withScope(token,ids,async ctx=>({
        ...modelFacts(await readFacts(ctx,token,ids),ctx.runtime,ids),
        planning:{discussionTurns:await discussionTurns(ctx),proposal:await latestProposal(ctx)},
      }),{leaseToken});
      if(call.toolName==='inspect_return_package') return await store.withScope(token,ids,ctx=>ctx.workflow.inspect(token,ids,input.packageId),{leaseToken});
      if(call.toolName==='execute_plan'){
        if(!componentGraph)reject('缺少持久化图配置','CHECKPOINT_CONFIG',503);
        const current=await components.state();
        if(!allowPlanChanges&&current.executionVersion!==input.planVersion)reject('该计划尚未由用户启动','USER_PLAN_REQUIRED',409);
        if(!current.archived)await components.start(input.planVersion);
        const result=await componentGraph.advance();
        return {...result,...(result.waiting?{stop:true}:{})};
      }
      if(call.toolName==='execute_step'){
        const current=await components.state();
        if(current.plan?.schemaVersion===2){
          if(!allowPlanChanges&&current.executionVersion!==input.planVersion)reject('该计划尚未由用户启动','USER_PLAN_REQUIRED',409);
          return await components.execute(input);
        }
      }
      return await executeWrite(call,input);
    } catch(error) {
      if(error.code==='LEASE_LOST') throw error;
      if(error.status>=400 && error.status<500) return {ok:false,code:error.code,message:error.message,...(error.code==='NEW_INPUT'?{stop:true}:{})};
      throw error;
    }
  }
  async function executeWrite(call,input) {
    const actionKey=call.toolName==='execute_step'?`step:${input.stepId}`:
      call.toolName==='save_plan'?`plan:${input.expectedVersion}:${hash(input.plan)}`:
        call.toolName==='finalize_plan'?`finalize:${input.proposalId}`:`call:${call.toolCallId}`;
    if(call.toolName==='evaluate_and_archive') {
      const cached=await store.withScope(token,ids,async ctx=>{
        const [[row]]=await ctx.db.execute('SELECT input_hash,result_json FROM agent_actions WHERE workspace_id=? AND chat_id=? AND run_id=? AND action_key=?',[...ctx.keys,actionKey]);
        if(row && row.input_hash!==hash(input))reject('动作参数冲突','ACTION_CONFLICT',409);
        return row?{...row.result_json,replayed:true}:null;
      },{leaseToken});
      if(cached)return cached;
    }
    return store.perform(token,ids,{toolName:call.toolName,actionKey,input,
      stepId:call.toolName==='execute_step'?input.stepId:undefined,
      planVersion:call.toolName==='execute_step'?input.planVersion:undefined,leaseToken},async ctx=>{
      if(eventId) {
        const [[newer]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? AND status='PENDING' AND source='USER'",[...ctx.keys,eventId]);
        if(Number(newer.n))reject('新的用户请求已排队，暂停本轮写操作并优先处理新请求','NEW_INPUT',409);
      }
      if(call.toolName==='execute_step') return executePlannedStep(ctx,{token,ids,stepId:input.stepId});
      if(call.toolName==='propose_plan')return proposePlan(ctx,input,eventId,token,ids);
      if(call.toolName==='finalize_plan'){
        const {proposal}=await confirmedProposal(ctx,input.proposalId,eventId);
        const saved=await savePlan(ctx,{expectedVersion:proposal.base_version,plan:proposal.plan_json},true);
        await markProposalConfirmed(ctx,input.proposalId,eventId);
        return {...saved,stop:true,proposalId:input.proposalId,message:'正式计划已保存。尚未启动；请测试人员另发执行指令。'};
      }
      if(call.toolName==='save_plan') return savePlan(ctx,input);
      if(call.toolName==='remember_case_notes') {
        await ctx.db.execute('UPDATE agent_runs SET memory_json=? WHERE workspace_id=? AND chat_id=? AND run_id=?',[canonical(input),...ctx.keys]);
        return {ok:true};
      }
      if(call.toolName==='wait_for_event') {
        const {progress}=await readFacts(ctx,token,ids);
        await ctx.db.execute('UPDATE agent_runs SET wait_json=? WHERE workspace_id=? AND chat_id=? AND run_id=?',
          [canonical({reason:input.reason,pendingSteps:progress.filter(s=>s.status!=='PASSED').map(s=>({id:s.id,status:s.status}))}),...ctx.keys]);
        return {ok:true,stop:true,reason:input.reason};
      }
      return archive(ctx);
    });
  }
  async function savePlan(ctx,input,confirmed=false) {
    if(eventId && !confirmed && (input.plan.schemaVersion===2 || ctx.runtime.plan_version===0))
      reject('新计划须先提交提案并由测试人员逐字确认','PLAN_CONFIRMATION_REQUIRED',409);
    if(ctx.runtime.plan_version!==input.expectedVersion) reject('计划已更新，请先读取当前版本','PLAN_CONFLICT',409);
    const {plan:previous,actions,components:started}=await readFacts(ctx,token,ids),plan=validatePlan(input.plan,previous,actions,started),version=input.expectedVersion+1;
    if(previous?.schemaVersion!==2&&plan.schemaVersion===2&&actions.length)reject('已执行旧计划需要在新run使用组件计划','PLAN_IMMUTABLE',409);
    for(const step of plan.steps.filter(s=>s.params.tradingAccountId)) {
      const [[account]]=await ctx.db.execute('SELECT id FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...ctx.keys,step.params.tradingAccountId]);
      if(!account)reject('计划账户不属于当前run','RECORD_NOT_FOUND',404);
    }
    await ctx.db.execute('INSERT INTO agent_plans(workspace_id,chat_id,run_id,version,plan_json) VALUES (?,?,?,?,?)',[...ctx.keys,version,canonical(plan)]);
    if(plan.schemaVersion===2)await syncComponents(ctx,plan,version);
    await ctx.db.execute('UPDATE agent_runs SET plan_version=?,execution_version=NULL,wait_json=NULL,verdict=\'UNDETERMINED\' WHERE workspace_id=? AND chat_id=? AND run_id=?',[version,...ctx.keys]);
    return {ok:true,planVersion:version,steps:plan.steps.map(s=>s.id)};
  }
  async function archive(ctx) {
    const {facts,plan,progress,actions}=await readFacts(ctx,token,ids);
    if(plan?.schemaVersion===2){
      if(plan.steps.some(s=>s.kind==='case.archive'))reject('请由plan中的归档组件完成归档','ARCHIVE_BLOCKED',409);
      const data=await readFacts(ctx,token,ids);
      return archiveCase({...ctx,...data,token,ids},{id:'manual_archive'});
    }
    if(!plan || progress.some(s=>s.status!=='PASSED')) reject('计划仍有未完成或预期不符的步骤','ARCHIVE_BLOCKED',409);
    for(const step of plan.steps.filter(s=>s.kind==='VERIFY_POSITION'))
      checkSnapshot(step,resolveTradingAccount(step,actions,facts),facts,progress);
    const [[pending]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND status NOT IN ('CONFIRMED','FAILED','CANCELED')",ctx.keys);
    const [[unresolved]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM reconciliations WHERE workspace_id=? AND chat_id=? AND run_id=? AND status NOT IN ('MATCHED','SYNCED')",ctx.keys);
    if(facts.applicationMore||facts.confirmationMore||Number(pending.n)||Number(unresolved.n) || facts.confirmations.some(c=>c.local_note)
      || facts.reconciliations.some(r=>!['MATCHED','SYNCED'].includes(r.status))) reject('仍有待处理申请或未解决对账事项','ARCHIVE_BLOCKED',409);
    const [[incoming]]=await ctx.db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='PENDING' AND source IN ('USER','RESUME')",ctx.keys);
    if(Number(incoming.n)) reject('有新的用户请求待处理，暂不归档','NEW_INPUT',409);
    await ctx.db.execute("UPDATE test_runs SET status='ARCHIVED' WHERE workspace_id=? AND chat_id=? AND id=?",ctx.keys);
    await ctx.db.execute("UPDATE agent_runs SET status='ARCHIVED',verdict='PASS',wait_json=NULL WHERE workspace_id=? AND chat_id=? AND run_id=?",ctx.keys);
    await ctx.db.execute("UPDATE agent_events SET status='DONE' WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='PENDING' AND source IN ('RETURN','DELIVERY')",ctx.keys);
    return {ok:true,archived:true,verdict:'PASS',steps:progress.map(s=>({id:s.id,businessOutcome:s.businessOutcome??null,status:s.status}))};
  }
  async function settleWait() {
    return store.withScope(token,ids,async ctx=>{
      const {facts,plan,progress}=await readFacts(ctx,token,ids);
      if(plan?.schemaVersion===2)return;
      let wait=ctx.runtime.wait_json;
      if(facts.reconciliations.some(r=>!['MATCHED','SYNCED'].includes(r.status)) || progress.some(s=>['FAILED','REVIEW'].includes(s.status)))
        wait={...wait,category:'REVIEW',reason:wait?.reason??'存在预期不符或份额对账事项，需要人工核对'};
      else if(!wait && progress.some(s=>s.status==='WAITING_RETURN'))
        wait={category:'RETURN',reason:'等待已生成文件的人工送测及对应02/04回传'};
      else if(!wait && progress.some(s=>s.kind==='VERIFY_POSITION' && s.eligible))
        wait={category:'RETURN',reason:'等待05回传及份额核对'};
      if(wait)await ctx.db.execute('UPDATE agent_runs SET wait_json=? WHERE workspace_id=? AND chat_id=? AND run_id=?',[canonical(wait),...ctx.keys]);
    },{write:true,leaseToken});
  }
  return {definitions:agentToolDefinitions,dispatch,settleWait,components};
}

function businessRules(input) {
  const result={accountBusinesses:metadata.accountBusinesses,
    ...capabilityCatalog(),
    transactionBusinesses:Object.fromEntries(Object.entries(metadata.businesses).map(([code,b])=>[code,b.name])),
    snapshotRule:'05保存快照并对账，不覆盖持仓；有差异需人工核对',negativeReasons:['NO_TA_ACCOUNT','NO_POSITION']};
  if(input.fileType) {
    const r=metadata.requirements[input.fileType];
    result.required=[...new Set([...(r.required??[]),...(r.requiredByBusiness?.[input.businessCode]??[])])];
    const confirmationType=input.fileType==='01'?'02':'04';
    result.confirmationFileType=confirmationType;
    result.confirmationFields=[...new Set(['21','22'].flatMap(version=>fieldsForFile(version,confirmationType).map(field=>field.name)))];
  }
  return result;
}
