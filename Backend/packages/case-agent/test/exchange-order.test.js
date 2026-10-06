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

test('timing evidence requires affirmative business statements, not identifiers or rejected mentions',async()=>{
 const base={objective:'申购',preconditions:[],scenarios:[{title:'申购',setup:'申请',action:'发文',expected:'回传',evidence:'文件'}],openQuestions:[]};
 const relative={...exchangePlan,steps:exchangePlan.steps.map((step,index)=>({...step,businessTime:{kind:'RELATIVE',value:index?'T+2':'T+1'}}))};
 const cases=[
  {plan:exchangePlan,messages:['单号 REF20261006X，文件名 REF20261007X'],ready:false},
  {plan:exchangePlan,messages:['业务日期20261006，回传日期20261007','不使用20261006作为业务日期'],ready:false},
  {plan:exchangePlan,messages:['业务日期20261006，回传日期20261007','业务日期改为20261008'],ready:false},
  {plan:exchangePlan,messages:['03 20261006，04 20261007','03日期改为20261008'],ready:false},
  {plan:exchangePlan,messages:['例如业务日期20261006，回传日期20261007只是举例'],ready:false},
  {plan:exchangePlan,messages:['20261006和20261007是日期格式'],ready:false},
  {plan:exchangePlan,messages:['业务日期20261006，回传日期20261007？'],ready:false},
  {plan:exchangePlan,messages:['业务日期2026-10-6，回传日期2026年10月7日'],ready:true},
  {plan:exchangePlan,messages:['03 20261006，04 20261007'],ready:true},
  {plan:relative,messages:['03使用T+1，04使用T+2','不使用 T+1'],ready:false},
  {plan:relative,messages:['03勿用T+1，04使用T+2'],ready:false},
  {plan:relative,messages:['03拒绝采用T+1，04使用T+2'],ready:false},
  {plan:relative,messages:['例如03 T+1，04 T+2仅作示例'],ready:false},
  {plan:relative,messages:['我看到T+1，也提到T+2'],ready:false},
  {plan:relative,messages:['03 T+10，04 T+20'],ready:false},
  {plan:relative,messages:['03使用T+1，04使用T+2','取消T+1安排'],ready:false},
  {plan:relative,messages:['03使用T+1，04使用T+2','03改为T+3'],ready:false},
  {plan:relative,messages:['03使用T+1，04使用T+2','03时间没定'],ready:false},
  {plan:relative,messages:['03使用T+1，04使用T+2'],ready:true},
  {plan:relative,messages:['不使用 T+1','03改为T+1，04使用T+2'],ready:true},
 ];
 for(const {plan,messages,ready} of cases) {
  const priorTurns=[{role:'user',content:messages[0]},{role:'assistant',content:'讨论业务'},{role:'user',content:'测试申购'},{role:'assistant',content:'讨论时间'}];
  if(messages.length>1)priorTurns.push({role:'user',content:messages[1]},{role:'assistant',content:'整理计划'});
  let calls=0;
  const graph=createDiscussionGraph({complete:async()=>++calls===1?JSON.stringify({...base,exchangePlan:plan}):'当前理解：文件时间还需要确认。\n建议先测：明确申请与回传的业务时间。\n请你确认：03和04分别采用什么时间？'});
  const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'整理计划'});
  assert.equal(result.proposal.exchangePlan.status,ready?'READY':'UNPLANNED',messages.join('；'));
  assert.equal(calls,ready?1:2,messages.join('；'));
 }
});

test('short per-file timing answers preserve a complete relative schedule',async()=>{
 const steps=[['01','T日'],['02','T+1'],['03','确认后当天'],['04','T+2']].map(([fileType,value],index)=>({
  stepId:'step'+fileType,roundId:index<2?'account':'trade',direction:index%2?'RECEIVE':'SEND',fileType,
  businessTime:{kind:'RELATIVE',value},required:true,dependsOn:index===0?[]:[{stepId:'step'+String(index).padStart(2,'0'),condition:index%2?'SENT':'CONFIRMED'}],
 }));
 const plan={objective:'开户申购',preconditions:[],scenarios:[{title:'开户申购',setup:'申请',action:'发文',expected:'回传',evidence:'文件'}],openQuestions:[],exchangePlan:{status:'READY',steps,openQuestions:[]}};
 let calls=0;
 const graph=createDiscussionGraph({complete:async()=>{calls++;return JSON.stringify(plan);}});
 const priorTurns=[{role:'user',content:'开户申购'},{role:'assistant',content:'讨论业务'},{role:'user',content:'需要先开户'},{role:'assistant',content:'请确认时间'}];
 const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'01 T日，02 T+1，03确认后当天，04 T+2'});
 assert.equal(result.proposal.exchangePlan.status,'READY');assert.equal(calls,1);
});
