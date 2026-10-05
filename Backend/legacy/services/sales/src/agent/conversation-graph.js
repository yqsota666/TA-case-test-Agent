import {StateGraph,StateSchema,START,END} from '@langchain/langgraph';
import {z} from 'zod';
import {pendingCalls} from './context.js';

const State=new StateSchema({calls:z.array(z.unknown()).default([]),terminal:z.unknown().nullable().default(null),
  metrics:z.unknown(),completed:z.boolean().default(false)});
const afterTool=state=>state.terminal?.archived?'complete':state.terminal?.stop?'explain':state.terminal?'complete':'model';
export function createConversationGraph(c) {
  const graph=new StateGraph(State);
  addInputNodes(graph,c);addModelNodes(graph,c);addTerminalNodes(graph,c);
  graph.addEdge(START,'load_input').addEdge('load_input','recover_calls');
  graph.addConditionalEdges('recover_calls',state=>state.terminal?afterTool(state):c.globalCase?'model':
    c.event.source==='USER'&&/^确认计划 [0-9a-f-]{36}$/.test(c.event.payload_json?.content?.trim()??'')?'confirm_plan':
      c.event.source==='USER'?'model':'advance_saved_plan',
    ['model','advance_saved_plan','confirm_plan','explain','complete']);
  graph.addConditionalEdges('confirm_plan',afterTool,['model','explain','complete']);
  graph.addConditionalEdges('advance_saved_plan',afterTool,['model','explain','complete']);
  graph.addConditionalEdges('model',state=>state.calls.length?'tools':'complete',['tools','complete']);
  graph.addConditionalEdges('tools',afterTool,['model','explain','complete']);
  graph.addEdge('explain','complete').addEdge('complete',END);
  return graph.compile({checkpointer:c.checkpointer});
}
function addInputNodes(graph,c) {
  graph.addNode('load_input',async()=>{await c.ensureInput();return {};});
  graph.addNode('recover_calls',async()=>{
    const executed=await c.executeCalls(pendingCalls(await c.leases.history(c.event)));
    return {terminal:executed.terminal??null,metrics:{...c.metrics()}};
  });
  graph.addNode('confirm_plan',async()=>{
    const proposalId=c.event.payload_json.content.trim().slice('确认计划 '.length);
    const call={type:'tool-call',toolName:'finalize_plan',toolCallId:'auto_confirm_'+c.event.public_id,input:{proposalId}};
    const history=await c.leases.history(c.event);
    if(!history.some(m=>m.role==='assistant'&&Array.isArray(m.content)&&m.content.some(t=>t.toolCallId===call.toolCallId)))
      await c.leases.append(c.event,[{role:'assistant',content:[call]}]);
    const executed=await c.executeCalls([call]);
    return {terminal:executed.terminal??{stop:true},metrics:{...c.metrics()}};
  });
  graph.addNode('advance_saved_plan',async()=>{
    const current=await c.tools.components.state();
    if(current.plan?.schemaVersion!==2||!current.executionVersion||current.executionVersion!==current.planVersion)return {};
    const call={type:'tool-call',toolName:'execute_plan',toolCallId:'auto_'+c.event.public_id,input:{planVersion:current.planVersion}};
    const history=await c.leases.history(c.event);
    if(!history.some(m=>m.role==='assistant'&&Array.isArray(m.content)&&m.content.some(t=>t.toolCallId===call.toolCallId)))
      await c.leases.append(c.event,[{role:'assistant',content:[call]}]);
    const executed=await c.executeCalls([call]);
    return {terminal:executed.terminal??{stop:true},metrics:{...c.metrics()}};
  });
}
function addModelNodes(graph,c) {
  graph.addNode('model',c.modelNode);
  graph.addNode('tools',async state=>{
    const executed=await c.executeCalls(state.calls);
    return {terminal:executed.terminal??null,calls:[],metrics:{...c.metrics()}};
  });
  graph.addNode('explain',async()=>{
    const history=await c.leases.history(c.event),last=history.at(-1);
    if(last?.role!=='assistant'){
      const result=await c.askModel(await c.leases.history(c.event,{forModel:true}),{final:true});
      await c.leases.append(c.event,result.response.messages);
    }
    return {metrics:{...c.metrics()}};
  });
}
function addTerminalNodes(graph,c) {
  graph.addNode('complete',async state=>{
    if(state.terminal?.archived){
      const content='全部计划预期已由后端核对通过，本次运行已归档。';
      if((await c.leases.history(c.event)).at(-1)?.content!==content)await c.leases.append(c.event,[{role:'assistant',content}]);
    }else if(state.terminal?.confirmationText){
      const last=(await c.leases.history(c.event)).at(-1);
      if(!JSON.stringify(last?.content??'').includes(state.terminal.confirmationText))
        await c.leases.append(c.event,[{role:'assistant',content:
          `完整计划提案已保存供审阅，尚未成为正式计划，也未执行。请检查提案 ${state.terminal.proposalId} 的全部组件；有修改请直接提出。确认后请单独发送：${state.terminal.confirmationText}` }]);
    }else if(c.tools.settleWait)await c.tools.settleWait();
    return {completed:true,metrics:{...c.metrics()}};
  });
}
