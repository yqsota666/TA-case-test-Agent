import test from 'node:test';
import assert from 'node:assert/strict';
import {createExchangeOrderGraph,createDiscussionGraph,proposeDiscussionPlan} from '../src/index.js';
import {exchangePlan} from './exchange-plan-fixture.js';
test('actual validate_exchange_order node rejects missing SEND and accepts scoped event snapshot',async()=>{
 const graph=createExchangeOrderGraph();assert.ok(graph.getGraph().nodes.validate_exchange_order);
 const input={plan:exchangePlan,stepId:'receive04',direction:'RECEIVE',fileType:'04',businessDate:'20261007'};
 await assert.rejects(graph.invoke({input}),{code:'ORDER_VIOLATION'});
 const result=await graph.invoke({input:{...input,completed:[{stepId:'send03',condition:'SENT'}]}});
 assert.equal(result.checked.step.stepId,'receive04');
});
test('unplanned exchange goes through AI timing question; complete plan skips extra model call',async()=>{
 const priorTurns=[{role:'user',content:'测试申购'},{role:'assistant',content:'讨论账户'},{role:'user',content:'已有账户'},{role:'assistant',content:'讨论日期'}];
 const base={objective:'测试申购',preconditions:[],scenarios:[{title:'申购',setup:'已有账户',action:'发送申请',expected:'确认成功',evidence:'确认文件'}],openQuestions:[]};
 const calls=[];
 const graph=createDiscussionGraph({complete:async args=>{calls.push(args);return calls.length===1?JSON.stringify({...base,exchangePlan:{status:'UNPLANNED',steps:[],openQuestions:['申请和回传分别是哪天？']}}):'当前理解：已有确认账户，需要申购测试。\n建议先测：按确认日期发送03并接收04。\n请你确认：申请和回传分别是哪一天？';}});
 assert.ok(graph.getGraph().nodes.ask_exchange_timing);
 const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'给我计划'});
 assert.equal(calls.length,2);assert.equal(result.promptVersion,'exchange-timing-v1');assert.match(result.reply,/哪一天/);assert.equal(result.proposal.exchangePlan.status,'UNPLANNED');
 let count=0;
 await proposeDiscussionPlan(createDiscussionGraph({complete:async()=>{count++;return JSON.stringify({...base,exchangePlan});}}),{priorTurns,userInput:'日期已确认20261006和20261007'});
 assert.equal(count,1);
});

test('assistant-only dates or invented model dates trigger timing discussion, not a runnable Plan',async()=>{
 const priorTurns=[{role:'user',content:'新开户后申购'},{role:'assistant',content:'建议20261006和20261007'},{role:'user',content:'先讨论，不确定日期'},{role:'assistant',content:'需要问时间'}];
 const proposal={objective:'申购',preconditions:[],scenarios:[{title:'申购',setup:'申请',action:'发文',expected:'回传',evidence:'文件'}],openQuestions:[],exchangePlan};
 let calls=0;
 const graph=createDiscussionGraph({complete:async()=>++calls===1?JSON.stringify(proposal):'当前理解：需要讨论文件业务时间。\n建议先测：按双方确认日期发送申请并接收结果。\n请你确认：03和04各使用哪一天？'});
 const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'给出计划'});
 assert.equal(result.proposal.exchangePlan.status,'UNPLANNED');assert.equal(calls,2);
});
