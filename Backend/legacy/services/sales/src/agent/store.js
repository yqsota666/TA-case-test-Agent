import crypto from 'node:crypto';
import { authenticateSession, resolveRun, assertWritableRun, scopeError } from '../platform/scope.js';
import { createWorkflowService } from '../platform/workflow-service.js';

export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k,normalize(value[k])]));
  return value;
}
export const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
export const keysOf = scope => [scope.workspace_id,scope.chat_id,scope.run_id];
export const reject = (message, code='AGENT_INPUT', status=400) => { throw scopeError(message,status,code); };
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) reject('参数不符合工具契约：'+result.error.issues.map(i=>i.path.join('.')+' '+i.message).join('; ').slice(0,600));
  return result.data;
}

export async function ensureRuntime(db, scope) {
  await db.execute(`INSERT IGNORE INTO agent_runs(workspace_id,chat_id,run_id,memory_json)
    VALUES (?,?,?,'{"notes":[]}')`,keysOf(scope));
}

export function createAgentStore({ transaction, authenticate=authenticateSession }) {
  async function withScope(token, ids, fn, {write=false,leaseToken}={}) {
    return transaction(async db => {
      const auth=await authenticate(db,token),scope=await resolveRun(db,auth,ids),keys=keysOf(scope);
      if (write) {
        await assertWritableRun(db,auth,scope);
        await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[scope.ta_environment_id]);
        const [[run]]=await db.execute('SELECT status FROM test_runs WHERE workspace_id=? AND chat_id=? AND id=? FOR UPDATE',keys);
        if (scope.chat_status!=='ACTIVE' || !['DRAFT','ACTIVE'].includes(run.status)) reject('当前运行已封存','RUN_LOCKED',409);
        await ensureRuntime(db,scope);
      }
      const [[runtime]]=await db.execute(`SELECT *,lease_until>UTC_TIMESTAMP(3) AS lease_valid FROM agent_runs
        WHERE workspace_id=? AND chat_id=? AND run_id=?${write?' FOR UPDATE':''}`,keys);
      if (leaseToken && (!runtime?.lease_valid || runtime.lease_token!==leaseToken)) reject('执行租约已失效','LEASE_LOST',409);
      const workflow=createWorkflowService({transaction:f=>f(db),authenticate});
      return fn({db,auth,scope,keys,runtime,workflow});
    });
  }

  async function state(token, ids) {
    return withScope(token,ids,async({db,keys,runtime,scope})=>{
      if (!runtime) return {runtime:null,planning:{discussionTurns:0,proposal:null},plan:null,components:[],actions:[],messages:[],events:[]};
      const [[plan]]=await db.execute('SELECT plan_json FROM agent_plans WHERE workspace_id=? AND chat_id=? AND run_id=? AND version=?',[...keys,runtime.plan_version]);
      const [actions]=await db.execute('SELECT step_key,tool_name,action_key,result_json,status FROM agent_actions WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id LIMIT 200',keys);
      const [messages]=await db.execute('SELECT id,event_id,message_json,created_at FROM agent_messages WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id DESC LIMIT 200',keys);
      const [events]=await db.execute('SELECT public_id,source,status,attempts,error_code,error_message,created_at FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id DESC LIMIT 50',keys);
      const [components]=await db.execute('SELECT step_key,kind,status,revision,attempts,output_json,wait_json,error_json FROM agent_components WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY step_key',keys);
      const [[proposal]]=await db.execute(`SELECT proposal_id,base_version,plan_hash,plan_json,status FROM agent_plan_proposals
        WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY proposal_sequence DESC LIMIT 1`,keys);
      const [[discussion]]=await db.execute("SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND source='USER'",keys);
      return {runtime:{planVersion:runtime.plan_version,revision:runtime.revision,status:runtime.status,
        executionVersion:runtime.execution_version,memory:runtime.memory_json,wait:runtime.wait_json,verdict:runtime.verdict},plan:plan?.plan_json??null,
        planning:{discussionTurns:Number(discussion.n),proposal:proposal?{
          id:proposal.proposal_id,baseVersion:proposal.base_version,planHash:proposal.plan_hash,
          plan:proposal.plan_json,status:proposal.status,
          confirmationText:proposal.status==='PROPOSED'?`确认计划 ${proposal.proposal_id}`:null,
        }:null},
        components,actions,messages:messages.reverse(),events,scope:{businessDate:scope.business_date instanceof Date?scope.business_date.toISOString().slice(0,10):String(scope.business_date).slice(0,10)}};
    });
  }

  async function perform(token, ids, command, fn) {
    return withScope(token,ids,async context=>{
      const {db,keys,runtime}=context,inputHash=hash(command.input);
      const [[prior]]=await db.execute('SELECT input_hash,result_json FROM agent_actions WHERE workspace_id=? AND chat_id=? AND run_id=? AND action_key=?',[...keys,command.actionKey]);
      if (prior) {
        if (prior.input_hash!==inputHash) reject('同一动作不能使用不同参数','ACTION_CONFLICT',409);
        return {...prior.result_json,replayed:true};
      }
      if (command.planVersion!==undefined && runtime.plan_version!==command.planVersion) reject('计划已更新，请重新读取','PLAN_CONFLICT',409);
      await db.query('SAVEPOINT agent_tool_action');
      let result;
      try { result=await fn(context); }
      catch(error) {
        if (!(error.status>=400 && error.status<500)) throw error;
        await db.query('ROLLBACK TO SAVEPOINT agent_tool_action');
        return {ok:false,code:error.code,message:error.message,...(error.code==='NEW_INPUT'?{stop:true}:{})};
      }
      if(!result.waiting)await db.execute(`INSERT INTO agent_actions(workspace_id,chat_id,run_id,action_key,step_key,tool_name,input_hash,input_json,result_json,status)
        VALUES (?,?,?,?,?,?,?,?,?,'DONE')`,[...keys,command.actionKey,command.stepId??null,command.toolName,inputHash,canonical(command.input),canonical(result)]);
      await db.execute('UPDATE agent_runs SET revision=revision+1 WHERE workspace_id=? AND chat_id=? AND run_id=?',keys);
      return result;
    },{write:true,leaseToken:command.leaseToken});
  }

  return {transaction,authenticate,withScope,state,perform};
}

// Constructed only by the trusted worker from an authenticated, persisted event actor.
export function workerAuthenticator({userId,workspaceId}) {
  return async db => {
    const [[actor]]=await db.execute(`SELECT u.id AS user_id,w.id AS workspace_id FROM platform_users u
      JOIN workspaces w ON w.owner_user_id=u.id WHERE u.id=? AND w.id=? AND u.status='ACTIVE'`,[userId,workspaceId]);
    if (!actor) reject('事件操作人已失效','UNAUTHENTICATED',401);
    return Object.freeze(actor);
  };
}
