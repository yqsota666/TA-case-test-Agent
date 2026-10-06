import { StateGraph, StateSchema, START, END, interrupt, MemorySaver, Command } from '@langchain/langgraph';
import { z } from 'zod';

export function workflowPosition(facts) {
  if (facts.chatStatus !== 'ACTIVE') return { stage:'CHAT_CLOSED', waiting:[] };
  if (['PASS','FAIL'].includes(facts.caseStatus)) return {stage:'CASE_FINAL', waiting:[]};
  if (!facts.plan || facts.plan.status==='DRAFT') return {stage:'DISCUSSION', waiting:['DISCUSS','PROPOSE_PLAN']};
  if (facts.plan.status !== 'LOCKED') return {stage:facts.dataConfirmed ? 'CONFIRM_EXPECTATIONS':'CONFIRM_PLAN_DATA', waiting:['PLAN_CONFIRM','DISCUSS']};
  if (!facts.generated) return {stage:'PREPARE_DATA',waiting:['DATA_EXECUTE']};
  if (!facts.draftConfirmed) return {stage:'CONFIRM_DRAFT',waiting:['DATA_CONFIRM']};
  if (!facts.order) return {stage:'DEFINE_EXCHANGE_ORDER',waiting:['EXCHANGE_PLAN_CONFIRM']};
  const completed = (id,condition) => facts.order.events.some(e=>e.stepId===id && e.condition===condition);
  const blocked=new Set((facts.order.blockers??[]).flatMap(b=>b.blockedStepIds));
  const outstanding = facts.order.plan.steps.filter(s=>!blocked.has(s.stepId) && !(s.direction==='SEND'?completed(s.stepId,'SENT'):(completed(s.stepId,'CONFIRMED') || completed(s.stepId,'APPLIED'))));
  if (outstanding.some(s=>s.required!==false)) {
    const waiting = outstanding.filter(s=>s.dependsOn.every(d=>completed(d.stepId,d.condition))).map(s=>({stepId:s.stepId,fileType:s.fileType,
      action:s.direction==='SEND'?'GENERATE_AND_DELIVER':completed(s.stepId,'PARSED')?'APPLY_RETURN':'UPLOAD_AND_PARSE'}));
    return {stage:'FILE_EXCHANGE',waiting};
  }
  const optionalActions=outstanding.filter(s=>s.required===false && s.dependsOn.every(d=>completed(d.stepId,d.condition))).map(s=>({stepId:s.stepId,fileType:s.fileType,action:s.direction==='SEND'?'GENERATE_AND_DELIVER':completed(s.stepId,'PARSED')?'APPLY_RETURN':'UPLOAD_AND_PARSE'}));
  const confirmable=facts.review?.confirmable===true;
  return {stage:confirmable ? 'CONFIRM_RESULT':'EVALUATE_RESULT',waiting:[confirmable?'RESULT_CONFIRM':'RESULT_EVALUATE'],optionalActions,...(facts.order.blockers?.length?{blockers:facts.order.blockers}:{})};
}

// The graph observes committed business facts. Replayed interrupt nodes cannot
// rerun model calls, mutate TA truth or repeat a business service transaction.
export function createDurableWorkflowGraph({checkpointer, readFacts}) {
  const schema = new StateSchema({position:z.any().optional(), revision:z.string().optional()});
  const graph=new StateGraph(schema).addNode('reconcile_committed_business',async()=>{
    const facts=await readFacts();return {position:workflowPosition(facts),revision:facts.revision};
  }).addEdge(START,'reconcile_committed_business');
  const stages=['DISCUSSION','CONFIRM_PLAN_DATA','CONFIRM_EXPECTATIONS','PREPARE_DATA','CONFIRM_DRAFT',
    'DEFINE_EXCHANGE_ORDER','FILE_EXCHANGE','EVALUATE_RESULT','CONFIRM_RESULT'];
  for(const stage of stages) graph.addNode(stage.toLowerCase(),state=>{
    interrupt({stage:state.position.stage,waiting:state.position.waiting,revision:state.revision});return {};
  }).addEdge(stage.toLowerCase(),'reconcile_committed_business');
  graph.addConditionalEdges('reconcile_committed_business',state=>stages.includes(state.position.stage)?state.position.stage.toLowerCase():END);
  return graph.compile({checkpointer});
}

export class SqlWorkflowSaver extends MemorySaver {
  constructor(db, keys, persisted) {
    super(); this.db=db; this.keys=keys;
    if (persisted) {
      const saved=JSON.parse(Buffer.from(persisted).toString('utf8'),(_,v)=>v?.byteArray ? Uint8Array.from(Buffer.from(v.byteArray,'base64')) : v);
      this.storage=saved.storage; this.writes=saved.writes;
    }
  }
  async persist() {
    const raw=Buffer.from(JSON.stringify({storage:this.storage,writes:this.writes},(_,v)=>v instanceof Uint8Array?{byteArray:Buffer.from(v).toString('base64')}:v));
    if(raw.length>16*1024*1024-1) throw Object.assign(new Error('工作流历史超过容量上限'),{code:'WORKFLOW_CAPACITY',status:409});
    await this.db.execute(`INSERT INTO case_workflow_checkpoints (workspace_id,chat_id,case_id,saver_blob)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE saver_blob=VALUES(saver_blob),updated_at=CURRENT_TIMESTAMP(3)`,[...this.keys,raw]);
  }
  async put(...args) {const config=await super.put(...args);await this.persist();return config;}
  async putWrites(...args) {await super.putWrites(...args);await this.persist();}
}

export async function reconcileWorkflow(graph, config) {
  const state=await graph.getState(config);
  if(state.tasks?.some(t=>t.interrupts?.length)) await graph.invoke(new Command({resume:{reconcile:true}}),config);
  else if(!state.values?.position || state.next?.length) await graph.invoke({},config);
  const next=await graph.getState(config);
  return { ...next.values.position,revision:next.values.revision,checkpointId:next.config.configurable.checkpoint_id,
    interrupted:next.tasks.some(t=>t.interrupts?.length)};
}
