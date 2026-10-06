import crypto from 'node:crypto';
import { authenticateSession,storeError } from './index.js';
import { createCaseResultRepository } from './case-result.js';
import { exchangeOrderContext } from './exchange-order.js';
import { SqlWorkflowSaver,createDurableWorkflowGraph,reconcileWorkflow,workflowPosition } from '../../case-agent/src/durable-workflow.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=v=>typeof v==='string'?JSON.parse(v):v;
export async function workflowScope(db,token,scope,write=false) {
 if(![scope.chatPublicId,scope.casePublicId].every(v=>uuid.test(v??'')))throw storeError('INVALID_INPUT',400,'Chat或Case标识无效');
 const auth=await authenticateSession(db,token);
 const [[owner]]=await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,c.status AS chat_status,k.status AS case_status
 FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
 WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=?${write?' FOR UPDATE':''}`,[auth.workspace_id,scope.chatPublicId,scope.casePublicId]);
 if(!owner)throw storeError('CASE_NOT_FOUND',404,'Case不存在');
 return {owner,keys:[auth.workspace_id,owner.chat_id,owner.case_id]};
}
export async function workflowFacts(db,{owner,keys},token,input) {
 const [[plan]]=await db.execute(`SELECT version_number AS version,status FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY version_number DESC LIMIT 1`,keys);
 const [[section]]=await db.execute(`SELECT COUNT(*) AS n FROM case_plan_section_confirmations WHERE workspace_id=? AND chat_id=? AND case_id=? AND version_number=? AND section='DATA'`,[...keys,plan?.version??0]);
 const [[draft]]=await db.execute(`SELECT EXISTS(SELECT 1 FROM case_data_executions WHERE workspace_id=? AND chat_id=? AND case_id=?) AS hasDraft,
 EXISTS(SELECT 1 FROM case_data_confirmations WHERE workspace_id=? AND chat_id=? AND case_id=?) AS confirmed`,[...keys,...keys]);
 const [[review]]=await db.execute(`SELECT CAST(id AS CHAR) AS id,evidence_sha256,plan_version,suggestion_json FROM case_result_reviews WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id DESC LIMIT 1`,keys);
 let order=null;
 if(plan?.status==='LOCKED')try {order=await exchangeOrderContext(db,keys,false);} catch(e) {if(e.code!=='EXCHANGE_PLAN_REQUIRED')throw e;}
 if(order) {
  const [appliedHoldings]=await db.execute(`SELECT DISTINCT r.step_id AS stepId FROM case_holdings_plan_receipts r
   JOIN case_holdings_return_parses p ON p.workspace_id=r.workspace_id AND p.chat_id=r.chat_id AND p.case_id=r.case_id AND p.id=r.parse_id
   WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? AND r.plan_version=? AND p.applied_at IS NOT NULL`,[...keys,order.version]);
  order.events.push(...appliedHoldings.map(e=>({...e,condition:'CONFIRMED'})));
  const [terminalReceipts]=await db.execute(`SELECT b.step_id AS stepId FROM case_exchange_plan_bindings b
   WHERE b.workspace_id=? AND b.chat_id=? AND b.case_id=? AND b.plan_version=? AND b.file_type IN ('02','04')
   AND EXISTS(SELECT 1 FROM case_exchange_plan_receipts r WHERE r.workspace_id=b.workspace_id AND r.chat_id=b.chat_id AND r.case_id=b.case_id AND r.plan_version=b.plan_version AND r.step_id=b.step_id)
   AND EXISTS(SELECT 1 FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id WHERE ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.batch_id AND a.case_id=b.case_id AND a.file_type=IF(b.file_type='02','01','03'))
   AND NOT EXISTS(SELECT 1 FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id WHERE ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.batch_id AND a.case_id=b.case_id AND a.file_type=IF(b.file_type='02','01','03') AND a.status NOT IN ('CONFIRMED','FAILED'))`,[...keys,order.version]);
  order.events.push(...terminalReceipts.map(e=>({...e,condition:'APPLIED'})));

 }

 let latestReview=null;
 if(review) {
  latestReview={id:review.id,confirmable:false};
  const suggestion=json(review.suggestion_json);
  if(['PASS','FAIL'].includes(suggestion?.outcome) && owner.chat_status==='ACTIVE' && !['PASS','FAIL'].includes(owner.case_status) && plan?.status==='LOCKED' && Number(review.plan_version)===Number(plan.version)) {
   const current=await createCaseResultRepository({transaction:action=>action(db)}).snapshot(token,input);
   latestReview.confirmable=current.sha256===review.evidence_sha256 && !current.pending.length && !current.issues.length;
   latestReview.currentEvidenceHash=current.sha256;
  }
 }
 const facts={chatStatus:owner.chat_status,caseStatus:owner.case_status,plan:plan??null,dataConfirmed:Number(section.n)>0,generated:Number(draft.hasDraft)>0,draftConfirmed:Number(draft.confirmed)>0,review:latestReview,order};
 facts.revision=crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');return facts;
}
export function createDurableWorkflowRepository({pool,lockTimeout=5}) {
 async function run(token,input,event) {
  if(event && (!uuid.test(input.eventId??'') || typeof input.expectedStage!=='string' || input.expectedStage.length>40))throw storeError('INVALID_INPUT',400,'恢复事件标识或等待阶段无效');
  const db=await pool.getConnection();let lockName;
  try {
   const initial=await workflowScope(db,token,input);
   lockName='case-workflow:'+crypto.createHash('sha256').update(initial.keys.join(':')).digest('hex').slice(0,48);
   const [[lock]]=await db.execute('SELECT GET_LOCK(?,?) AS acquired',[lockName,lockTimeout]);
   if(Number(lock.acquired)!==1)throw storeError('WORKFLOW_BUSY',409,'工作流正在恢复，请稍后重试同一事件');
   await db.beginTransaction();
   const scope=await workflowScope(db,token,input,true);
   if(event && scope.owner.chat_status!=='ACTIVE')throw storeError('CHAT_CLOSED',409,'Chat已结束，仅可读取工作流');
   if(event) {
    const [[saved]]=await db.execute(`SELECT expected_stage,response_json FROM case_workflow_events WHERE workspace_id=? AND chat_id=? AND case_id=? AND event_id=?`,[...scope.keys,input.eventId]);
    if(saved) {
     if(saved.expected_stage!==input.expectedStage)throw storeError('WORKFLOW_EVENT_CONFLICT',409,'同一事件不能更换内容');
     await db.commit();return {...json(saved.response_json),replayed:true};
    }
   }
   const [[row]]=await db.execute(`SELECT saver_blob FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?`,scope.keys);
   const facts=await workflowFacts(db,scope,token,input);
   if(event && facts.chatStatus!=='ACTIVE')throw storeError('CHAT_CLOSED',409,'Chat已结束，仅可读取工作流');
   const saver=new SqlWorkflowSaver(db,scope.keys,row?.saver_blob);
   const graph=createDurableWorkflowGraph({checkpointer:saver,readFacts:async()=>facts});
   const config={configurable:{thread_id:'case:'+scope.keys.join(':'),checkpoint_ns:''},recursionLimit:8};
   const prior=await graph.getState(config);
   let result;
   if(prior.values?.revision===facts.revision) result={...prior.values.position,revision:facts.revision,checkpointId:prior.config.configurable.checkpoint_id,interrupted:prior.tasks.some(t=>t.interrupts?.length)};
   else if(facts.chatStatus!=='ACTIVE') result={...workflowPosition(facts),revision:facts.revision,checkpointId:prior.config.configurable.checkpoint_id??null,interrupted:false};
   else result=await reconcileWorkflow(graph,config);
   if(event)await db.execute(`INSERT INTO case_workflow_events (workspace_id,chat_id,case_id,event_id,expected_stage,response_json) VALUES (?,?,?,?,?,?)`,[...scope.keys,input.eventId,input.expectedStage,JSON.stringify(result)]);
   await db.commit();return result;
  } catch(error) {await db.rollback();throw error;}
  finally {try {if(lockName)await db.execute('SELECT RELEASE_LOCK(?)',[lockName]);}finally{db.release();}}
 }
 return {read:(token,scope)=>run(token,scope,false),resume:(token,input)=>run(token,input,true)};
}
