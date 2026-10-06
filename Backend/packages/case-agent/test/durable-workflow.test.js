import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySaver } from '@langchain/langgraph';
import { createDurableWorkflowGraph,reconcileWorkflow,workflowPosition,SqlWorkflowSaver } from '../src/durable-workflow.js';
const base={chatStatus:'ACTIVE',caseStatus:'DRAFT',plan:null,revision:'1'};
test('native interrupt resumes durable facts after graph recreation; external input cannot fake business stage',async()=>{
 let facts={...base};let blob;
 const db={execute:async(_sql,args)=>{blob=args.at(-1);}};
 let saver=new SqlWorkflowSaver(db,[1,2,3]);
 const config={configurable:{thread_id:'case:1:2:3',checkpoint_ns:''},recursionLimit:8};
 let graph=createDurableWorkflowGraph({checkpointer:saver,readFacts:async()=>facts});
 const first=await reconcileWorkflow(graph,config);assert.equal(first.stage,'DISCUSSION');assert.equal(first.interrupted,true);
 saver=new SqlWorkflowSaver(db,[1,2,3],blob);graph=createDurableWorkflowGraph({checkpointer:saver,readFacts:async()=>facts});
 assert.equal((await graph.getState(config)).next[0],'discussion');
 facts={...facts,plan:{status:'PENDING_CONFIRMATION'},revision:'2'};
 assert.equal((await reconcileWorkflow(graph,config)).stage,'CONFIRM_PLAN_DATA');
 facts={...facts,dataConfirmed:true,revision:'3'};
 assert.equal((await reconcileWorkflow(graph,config)).stage,'CONFIRM_EXPECTATIONS');
 facts={...facts,plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:{plan:{steps:[]},events:[]},review:{id:'1'},revision:'4'};
 assert.equal((await reconcileWorkflow(graph,config)).stage,'CONFIRM_RESULT');
 facts={...facts,caseStatus:'PASS',revision:'5'};assert.equal((await reconcileWorkflow(graph,config)).interrupted,false);
});
test('05 parallel DAG readiness and direct 03; parse alone cannot complete receipts',()=>{
 const step=(stepId,fileType,direction,dependsOn=[])=>({stepId,fileType,direction,dependsOn});
 const facts={...base,plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:{plan:{steps:[step('buy','03','SEND'),step('result','04','RECEIVE',[{stepId:'buy',condition:'SENT'}]),step('balance','05','RECEIVE')]},events:[]}};
 assert.deepEqual(workflowPosition(facts).waiting.map(s=>s.fileType),['03','05']);
 facts.order.events=[{stepId:'buy',condition:'SENT'},{stepId:'result',condition:'PARSED'}];
 assert.equal(workflowPosition(facts).waiting.find(s=>s.fileType==='04').action,'APPLY_RETURN');
 facts.order.events.push({stepId:'result',condition:'CONFIRMED'},{stepId:'balance',condition:'CONFIRMED'});
 assert.equal(workflowPosition(facts).stage,'EVALUATE_RESULT');
});
test('saver checkpoints isolate threads and closed Chats terminate',async()=>{
 const saver=new MemorySaver();
 const graph=createDurableWorkflowGraph({checkpointer:saver,readFacts:async()=>base});
 await reconcileWorkflow(graph,{configurable:{thread_id:'a',checkpoint_ns:''}});
 assert.deepEqual((await graph.getState({configurable:{thread_id:'b',checkpoint_ns:''}})).values,{});
 assert.equal(workflowPosition({...base,chatStatus:'CLOSED'}).stage,'CHAT_CLOSED');
});

test('failed receipt finishes its own step without satisfying a downstream success dependency',()=>{
 const facts={...base,plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:{plan:{steps:[{stepId:'account',fileType:'02',direction:'RECEIVE',dependsOn:[]}]},events:[{stepId:'account',condition:'APPLIED'}]}};
 assert.equal(workflowPosition(facts).stage,'EVALUATE_RESULT');
 facts.order.plan.steps.push({stepId:'buy',fileType:'03',direction:'SEND',dependsOn:[{stepId:'account',condition:'CONFIRMED'}]});
 assert.deepEqual(workflowPosition(facts).waiting,[]);
});
