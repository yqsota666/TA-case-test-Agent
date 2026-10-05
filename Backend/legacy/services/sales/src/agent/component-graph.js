import {StateGraph,StateSchema,Command,START,END,interrupt} from '@langchain/langgraph';
import {z} from 'zod';
import {AsyncLocalStorageProviderSingleton} from '@langchain/core/singletons';
import {componentHandlers} from './components.js';

const GraphState=new StateSchema({selected:z.string().nullable().default(null),attempted:z.array(z.string()).default([]),
  planVersion:z.number().default(0),wait:z.unknown().nullable().default(null),result:z.unknown().nullable().default(null)});
export const runThreadId=event=>`case:${event.workspace_id}:${event.chat_id}:${event.run_id}`;
const nodeName=kind=>'component_'+kind.replaceAll('.','_');

export function createComponentGraph({components,checkpointer,threadId}) {
  if(!threadId)throw new Error('Component graph requires a scoped thread ID');
  const config={configurable:{thread_id:threadId+':components:v2',checkpoint_ns:''},recursionLimit:1000,durability:'sync'};
  const graph=new StateGraph(GraphState).addNode('select',async state=>{
    const current=await components.state();
    if(current.archived)return {selected:'complete',result:{ok:true,archived:true}};
    if(current.executionVersion!==current.planVersion)return {selected:'complete',result:{ok:true,needsStart:true}};
    const data=await components.state({refresh:true});
    const next=data.plan.steps.find(s=>{
      const row=data.components.find(r=>r.step_key===s.id);
      return row.status==='READY'||(['WAITING_INPUT','REVIEW'].includes(row.status)&&!state.attempted.includes(s.id));
    });
    if(next)return {selected:next.id,planVersion:data.planVersion};
    const wait=await components.saveWait(data);
    return {selected:wait.components.length?'pause':'complete',wait,result:{ok:true,completed:!wait.components.length}};
  });
  for(const kind of Object.keys(componentHandlers))graph.addNode(nodeName(kind),async state=>{
    const result=await components.execute({stepId:state.selected,planVersion:state.planVersion});
    if(result.stop)return new Command({update:{result},goto:END});
    return {attempted:[...state.attempted,state.selected],result};
  }).addEdge(nodeName(kind),'select');
  graph.addNode('pause',state=>{interrupt(state.wait);return {attempted:[],wait:null};}).addEdge('pause','select');
  graph.addEdge(START,'select').addConditionalEdges('select',async state=>{
    if(state.selected==='complete')return END;
    if(state.selected==='pause')return 'pause';
    const {plan}=await components.state();
    return nodeName(plan.steps.find(s=>s.id===state.selected).kind);
  },[END,'pause',...Object.keys(componentHandlers).map(nodeName)]);
  const compiled=graph.compile({checkpointer});
  async function advanceRoot() {
    const current=await components.state();
    const snapshot=await compiled.getState(config);
    const paused=snapshot.tasks?.some(t=>t.interrupts?.length);
    if(snapshot.next?.length&&!paused&&snapshot.values.planVersion!==current.planVersion){
      await compiled.updateState(config,{attempted:[],planVersion:current.planVersion},'pause');
    }
    const input=paused?new Command({resume:{inputArrived:true}}):snapshot.next?.length?null:{attempted:[],result:null};
    const result=await compiled.invoke(input,config);
    const wait=result.__interrupt__?.[0]?.value??null;
    return {...(result.result??{}),waiting:!!result.__interrupt__?.length,wait,files:wait?.files??[]};
  }
  // This is a durable per-run graph, not a per-event subgraph. Clear parent
  // task/scratchpad configuration so its namespace stays stable across events.
  const advance=()=>AsyncLocalStorageProviderSingleton.runWithConfig({},advanceRoot);
  return {advance,graph:compiled,config};
}
