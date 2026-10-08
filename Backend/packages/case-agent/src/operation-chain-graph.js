import crypto from 'node:crypto';
import {StateGraph,StateSchema,START,END} from '@langchain/langgraph';
import {z} from 'zod';
import {observeGraph} from './observability.js';
import {operationTasks} from '../../platform-protocol/src/operation-chain.js';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';

export const operationSerial = ({casePublicId,channelId,key}) => 'AI'+crypto.createHash('sha256')
  .update(`${casePublicId}:${channelId}:${key}`).digest('hex').slice(0,22);
const delivered=new Set(['DELIVERED','WAITING_RETURN','CONFIRMED','FAILED']);
const satisfies=(app,condition)=>condition==='SENT'?delivered.has(app?.status):app?.status===condition;

export function reconcileOperations({plan,applications=[],events=[],casePublicId,channelId,locked=true}) {
  if(!validPlanContract(plan.contract,plan))throw Object.assign(new Error('任务单结构无效，请重新整理方案'),{code:'INVALID_OPERATION_CHAIN',status:409});
  const tasks=operationTasks(plan),actual=new Map();
  for(const task of tasks)actual.set(task.key,applications.find(a=>a.channelId===String(channelId) &&
    a.applicationNumber===operationSerial({casePublicId,channelId,key:task.key})));
  const blocked=new Set();
  for(const task of tasks) {
    const impossible=(task.dependsOn??[]).some(d=>blocked.has(d.applicationKey) ||
      ['CONFIRMED','FAILED'].includes(actual.get(d.applicationKey)?.status) && !satisfies(actual.get(d.applicationKey),d.condition));
    if(impossible)blocked.add(task.key);
  }
  const rows=tasks.map(task=>{
    const app=actual.get(task.key),step=plan.exchangePlan.steps.find(s=>s.stepId===task.stepId);
    const unmet=(task.dependsOn??[]).filter(d=>!satisfies(actual.get(d.applicationKey),d.condition));
    const fileWaiting=step.dependsOn.filter(d=>!events.some(e=>e.stepId===d.stepId && e.condition===d.condition));
    const state=app?.status ?? (!locked?'PROPOSED':!task.canApply?'UNSUPPORTED':blocked.has(task.key)?'BLOCKED':
      unmet.length || fileWaiting.length?'WAITING':'READY');
    return {...task,state,unmet,fileWaiting,applicationNumber:app?.applicationNumber??null};
  });
  return {tasks:rows,readyKeys:rows.filter(t=>['READY','BATCHED','GENERATED'].includes(t.state)).map(t=>t.key),
    waitingKeys:rows.filter(t=>['WAITING','BLOCKED','UNSUPPORTED'].includes(t.state)).map(t=>t.key)};
}

export function createOperationChainGraph() {
  const graph=new StateGraph(new StateSchema({input:z.unknown(),schedule:z.unknown().nullable().default(null)}));
  graph.addNode('reconcile_account_operations',({input})=>({schedule:reconcileOperations(input)}));
  graph.addEdge(START,'reconcile_account_operations').addEdge('reconcile_account_operations',END);
  return observeGraph(graph.compile());
}
