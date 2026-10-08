import test from 'node:test';
import assert from 'node:assert/strict';
import {StateGraph,StateSchema,START,END,MemorySaver} from '@langchain/langgraph';
import {createDurableWorkflowGraph,reconcileWorkflow} from '../src/durable-workflow.js';
import {z} from 'zod';
import {initializeObservability,observeGraph,observeRequest,observeModel,flushObservability,shutdownObservability,maskObservationData,requestObservationContext} from '../src/observability.js';

test('disabled observation preserves results and errors without requiring credentials',async()=>{
  assert.equal(await observeModel({},async()=>42),42);
  const error=new Error('unchanged');await assert.rejects(observeModel({},async()=>{throw error;}),e=>e===error);
});
test('only whitelisted metadata survives and URL query/unknown path values are excluded',()=>{
  assert.deepEqual(maskObservationData({data:{token:'secret',images:['raw'],case_id:'case',attempt:2}}),{case_id:'case',attempt:2});
  assert.equal(maskObservationData({data:'customer raw text'}),'[content not collected]');
  assert.equal(requestObservationContext({method:'GET',url:'/api/files/private-secret?key=secret'}).name,'GET /api/files/:id');
});
test('enabled graph/model traces correlate concurrent requests and exclude state and raw exception text',async()=>{
  const spans=[];
  let offline=false;
  const exporter={export(batch,done){spans.push(...batch);done(offline?{code:1,error:new Error('synthetic exporter offline')}:{code:0});},shutdown:async()=>{},forceFlush:async()=>{}};
  initializeObservability({CASE_OBSERVABILITY_ENABLED:'1',LANGFUSE_PUBLIC_KEY:'test',LANGFUSE_SECRET_KEY:'test',LANGFUSE_BASE_URL:'http://localhost:3000'},{exporter});
  try {
    const graph=new StateGraph(new StateSchema({secret:z.string()})).addNode('check',async()=>{
      await observeModel({model:'synthetic',purpose:'test',attempt:1},async s=>{s.update({usageDetails:{input:2,output:3}});});return {};
    }).addEdge(START,'check').addEdge('check',END);
    const compiled=observeGraph(graph.compile());
    const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
    const headers=[];
    await Promise.all(ids.map(id=>observeRequest({method:'POST',url:`/api/chats/${id}/cases/${id}/discussion`},{statusCode:200,setHeader:(k,v)=>headers.push(v)},()=>compiled.invoke({secret:'PRIVATE_STATE'}))));
    const failure=Object.assign(new Error('PRIVATE_ERROR'),{code:'MODEL_TIMEOUT'});
    await assert.rejects(observeRequest({method:'POST',url:'/api/plan'},{statusCode:500,setHeader:()=>{}},()=>observeModel({model:'synthetic'},async()=>{throw failure;})),e=>e===failure);
    let facts={chatStatus:'ACTIVE',caseStatus:'DRAFT',plan:null,revision:'1'};
    const durable=createDurableWorkflowGraph({checkpointer:new MemorySaver(),readFacts:async()=>facts});
    const config={configurable:{thread_id:'synthetic-workflow',checkpoint_ns:''}};
    assert.equal((await reconcileWorkflow(durable,config)).stage,'DISCUSSION');
    facts={...facts,plan:{status:'PENDING_CONFIRMATION'},revision:'2'};
    assert.equal((await reconcileWorkflow(durable,config)).stage,'CONFIRM_PLAN_DATA');
    await flushObservability();
    assert.equal(new Set(headers).size,2);
    for(const trace of headers){const group=spans.filter(s=>s.spanContext().traceId===trace);assert.ok(group.some(s=>s.name==='model.call'));assert.ok(group.some(s=>s.name==='check'),JSON.stringify(spans.map(s=>({name:s.name,trace:s.spanContext().traceId}))));}
    const raw=JSON.stringify(spans.map(s=>({name:s.name,attributes:s.attributes,status:s.status,events:s.events})));
    assert.ok(!raw.includes('PRIVATE_STATE'));assert.ok(!raw.includes('PRIVATE_ERROR'));assert.ok(raw.includes('MODEL_TIMEOUT'));
    assert.ok(!spans.filter(s=>['discussion','confirm_plan_data'].includes(s.name)).some(s=>s.attributes['langfuse.observation.level']==='ERROR'));
    offline=true;
    assert.equal(await observeModel({model:'synthetic'},async()=>42),42);
    await flushObservability().catch(()=>{});
  }finally{await shutdownObservability();}
});
