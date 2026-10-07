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
 assert.equal(calls.length,2);assert.ok(!calls[1].system.includes('申请和回传分别是哪天？'));assert.deepEqual(JSON.parse(calls[1].messages.at(-1).content).unresolvedExchangeQuestions,['申请和回传分别是哪天？']);assert.equal(result.promptVersion,'exchange-timing-context-v2');assert.match(result.reply,/哪一天/);assert.equal(result.proposal.exchangePlan.status,'UNPLANNED');
 let count=0;
 await proposeDiscussionPlan(createDiscussionGraph({complete:async()=>{count++;return JSON.stringify({...base,exchangePlan});}}),{priorTurns,userInput:'03日期已确认20261006，04日期已确认20261007'});
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

test('shared times require evidence for each file while unscoped rejection remains global',async()=>{
 const base={objective:'交换文件',preconditions:[],scenarios:[{title:'交换',setup:'申请',action:'发文',expected:'回传',evidence:'文件'}],openQuestions:[]};
 const dates={status:'READY',openQuestions:[],steps:[
  {...exchangePlan.steps[0],stepId:'send01',roundId:'account1',fileType:'01',businessTime:{kind:'DATE',value:'20261006'}},
  {...exchangePlan.steps[1],stepId:'receive02',roundId:'account1',fileType:'02',businessTime:{kind:'DATE',value:'20261006'},dependsOn:[{stepId:'send01',condition:'SENT'}]},
 ]};
 const relative={...exchangePlan,steps:exchangePlan.steps.map(step=>({...step,businessTime:{kind:'RELATIVE',value:'T+1'}}))};
 const isoDates={...dates,steps:dates.steps.map(step=>({...step,businessTime:{kind:'DATE',value:'20261001'}}))};
 const cases=[
  {plan:dates,messages:['02 回报日期是20261006'],ready:false,missing:['send01']},
  {plan:dates,messages:['02 业务日期是20261006'],ready:false,missing:['send01']},
  {plan:dates,messages:['01 业务日期是20261006'],ready:false,missing:['receive02']},
  {plan:dates,messages:['02所有文件日期是20261006'],ready:false,missing:['send01']},
  {plan:dates,messages:['日期是20261006'],ready:false},
  {plan:dates,messages:['01和02日期是20261006'],ready:true},
  {plan:dates,messages:['01/02日期是20261006'],ready:true},
  {plan:dates,messages:['全部文件日期是20261006'],ready:true},
  {plan:dates,messages:['所有文件除了02日期是20261006'],ready:false},
  {plan:{...exchangePlan,steps:exchangePlan.steps.map(step=>({...step,businessTime:{kind:'DATE',value:'20261006'}}))},messages:['03和04都20261006'],ready:true},
  {plan:dates,messages:['业务日期是20261006，回报日期是20261006'],ready:true},
  {plan:isoDates,messages:['业务日期2026-10-01，回报日期2026-10-01'],ready:true},
  {plan:relative,messages:['04 T+1'],ready:false,missing:['send03']},
  {plan:relative,messages:['回报时间T+1'],ready:false,missing:['send03']},
  {plan:relative,messages:['04业务时间T+1'],ready:false,missing:['send03']},
  {plan:relative,messages:['03和04都使用T+1'],ready:true},
  {plan:relative,messages:['所有文件T+1'],ready:true},
  {plan:relative,messages:['03 T+1，04 T+1','不使用T+1'],ready:false,missing:['send03','receive04']},
  {plan:relative,messages:['03 T+1，04 T+1','04不使用T+1'],ready:false,missing:['receive04']},
  {plan:relative,messages:['03 T+1，04 T+1','回报时间不使用T+1'],ready:false,missing:['receive04']},
  {plan:dates,messages:['01和02日期是20261006','不使用20261006'],ready:false,missing:['send01','receive02']},
 ];
 for(const {plan,messages,ready,missing} of cases) {
  const priorTurns=[{role:'user',content:messages[0]},{role:'assistant',content:'讨论业务'},{role:'user',content:'测试交换'},{role:'assistant',content:'讨论时间'}];
  if(messages.length>1)priorTurns.push({role:'user',content:messages[1]},{role:'assistant',content:'整理计划'});
  let calls=0;
  const graph=createDiscussionGraph({complete:async()=>++calls===1?JSON.stringify({...base,exchangePlan:plan}):'当前理解：文件时间还需要确认。\n建议先测：明确申请与回传的业务时间。\n请你确认：每个文件分别采用什么时间？'});
  const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'整理计划'});
  assert.equal(result.proposal.exchangePlan.status,ready?'READY':'UNPLANNED',messages.join('；'));
  assert.equal(calls,ready?1:2,messages.join('；'));
  if(missing)assert.deepEqual(result.proposal.exchangePlan.openQuestions.map(question=>question.match(/^请确认 (\d{2}) 文件/)[1]),missing.map(id=>plan.steps.find(step=>step.stepId===id).fileType),messages.join('；'));
 }
});

test('offset digits and natural rescheduling cannot supply or preserve unrelated file evidence',async()=>{
 const base={objective:'交换文件',preconditions:[],scenarios:[{title:'交换',setup:'申请',action:'发文',expected:'回传',evidence:'文件'}],openQuestions:[]};
 const offsetPlan=value=>({status:'READY',openQuestions:[],steps:[['01','T日'],['02',value],['03','T日'],['04',value]].map(([fileType,time],index)=>({
  stepId:'step'+fileType,roundId:index<2?'account':'trade',direction:index%2?'RECEIVE':'SEND',fileType,
  businessTime:{kind:'RELATIVE',value:time},required:true,dependsOn:index===0?[]:[{stepId:'step'+String(index).padStart(2,'0'),condition:index%2?'SENT':'CONFIRMED'}],
 }))});
 const cases=[];
 for(const value of ['T+02','T-02','T+02日','T + 02','T＋02','T−02','T+2.02','确认后02天','02:04']) {
  cases.push({plan:offsetPlan(value),messages:[`01和03使用T日，04使用${value}`],ready:false,missing:['step02']});
  cases.push({plan:offsetPlan(value),messages:[`01和03使用T日，02和04使用${value}`],ready:true});
 }
 cases.push({plan:offsetPlan('T+02'),messages:['01和03使用T日，第02轮04使用T+02'],ready:false,missing:['step02']});
 cases.push({plan:offsetPlan('T+02'),messages:['01和03使用T日，REF02使用T+02，04使用T+02'],ready:false,missing:['step02']});
 const relative={...exchangePlan,steps:exchangePlan.steps.map((step,index)=>({...step,businessTime:{kind:'RELATIVE',value:index?'T+2':'T+1'}}))};
 for(const change of ['03改为周三','03改成星期三','03更改为礼拜三','03变成明天','03换成下周','03调整到下午','03改到周五','03周三','03候选周三','03考虑明天','03取消','03放弃','03撤销','03停止','03作废','03不用了','03不要了','03时间待定'])
  cases.push({plan:relative,messages:['03使用T+1，04使用T+2',change],ready:false,missing:['send03']});
 cases.push({plan:relative,messages:['03使用T+1，04使用T+2','04改为周三'],ready:false,missing:['receive04']});
 for(const change of ['03从T+1改为周三','03把T+1换成T+3','03从T+1推迟到周三','03从T+1延期一周','03停止使用T+1','03撤销T+1','03暂缓T+1'])
  cases.push({plan:relative,messages:['03使用T+1，04使用T+2',change],ready:false,missing:['send03']});
 cases.push({plan:relative,messages:['03使用T+1，04使用T+2','撤销T+1'],ready:false,missing:['send03']});
 cases.push({plan:exchangePlan,messages:['03日期20261006，04日期20261007','03从20261006改为20261008'],ready:false,missing:['send03']});
 cases.push({plan:relative,messages:['03从T+3改为T+1，04使用T+2'],ready:true});
 cases.push({plan:relative,messages:['03使用T+1，04使用T+2','03保持T+1'],ready:true});
 for(const {plan,messages,ready,missing} of cases) {
  const priorTurns=[{role:'user',content:messages[0]},{role:'assistant',content:'讨论业务'},{role:'user',content:'测试交换'},{role:'assistant',content:'讨论时间'}];
  if(messages.length>1)priorTurns.push({role:'user',content:messages[1]},{role:'assistant',content:'整理计划'});
  let calls=0;
  const graph=createDiscussionGraph({complete:async()=>++calls===1?JSON.stringify({...base,exchangePlan:plan}):'当前理解：文件时间还需要确认。\n建议先测：明确申请与回传的业务时间。\n请你确认：每个文件分别采用什么时间？'});
  const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'整理计划'});
  assert.equal(result.proposal.exchangePlan.status,ready?'READY':'UNPLANNED',messages.join('；'));
  assert.equal(calls,ready?1:2,messages.join('；'));
  if(missing)assert.deepEqual(result.proposal.exchangePlan.openQuestions.map(question=>question.match(/^请确认 (\d{2}) 文件/)[1]),missing.map(id=>plan.steps.find(step=>step.stepId===id).fileType),messages.join('；'));
 }
});


test('human same-day receives and year-elided send dates remain grounded in that message',async()=>{
 const dates={...exchangePlan,steps:exchangePlan.steps.map(s=>({...s,businessTime:{kind:'DATE',value:s.fileType==='01'||s.fileType==='02'?'20270111':'20270112'}}))};
 const p={objective:'开户后申购',preconditions:[],scenarios:[{title:'正向链路',setup:'新客户',action:'文件交换',expected:'开户成功；申购成功',evidence:'TA回传'}],openQuestions:[],exchangePlan:dates};
 let calls=0;
 const g=createDiscussionGraph({complete:async()=>{calls++;return JSON.stringify(p);}});
 const priorTurns=[{role:'user',content:'开户后申购'},{role:'assistant',content:'请补充范围'},{role:'user',content:'只有正向链路'},{role:'assistant',content:'请确定日期'}];
 const result=await proposeDiscussionPlan(g,{priorTurns,userInput:'2027年1月11日发01，当天收到成功02并确认同步；1月12日发03，当天收到成功04并确认同步。申请时间09:30:00。'});
 assert.equal(calls,1);assert.equal(result.proposal.exchangePlan.status,'READY');
});


test('separate rounds may affirm different dates in one human message, including same-day returns',async()=>{
 const {guardExchangeTimeEvidence}=await import('../src/plan-proposal.js');
 const steps=['20261102','20261104'].flatMap((date,i)=>exchangePlan.steps.map(step=>({...step,stepId:`${step.stepId}_${i}`,roundId:`r${i}`,businessTime:{kind:'DATE',value:date},dependsOn:step.dependsOn.map(d=>({...d,stepId:`${d.stepId}_${i}`}))})));
 const proposal={exchangePlan:{...exchangePlan,steps}};
 const text='客户甲03业务日期2026-11-02，04同日接收；客户乙03业务日期2026-11-04，04同日接收。';
 assert.equal(guardExchangeTimeEvidence(proposal,[text]).exchangePlan.status,'READY');
 assert.equal(guardExchangeTimeEvidence(proposal,[text,'03日期改为2026-11-06']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence(proposal,[text,'03日期取消']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence(proposal,[text+'03日期2026-11-02取消；客户乙03业务日期2026-11-04。']).exchangePlan.status,'UNPLANNED');
});


test('batching instructions do not revoke explicit send dates',async()=>{
 const {guardExchangeTimeEvidence}=await import('../src/plan-proposal.js');
 const p={exchangePlan:{status:'READY',openQuestions:[],steps:[
 {stepId:'a',fileType:'01',direction:'SEND',businessTime:{kind:'DATE',value:'20261102'}},
 {stepId:'b',fileType:'03',direction:'SEND',businessTime:{kind:'DATE',value:'20261104'}}]}};
 const message='01业务日期为2026-11-02；03业务日期为2026-11-04。不要按客户拆成三次01或三次03，一批01包含全部开户记录，一批03包含全部申购记录。';
 assert.equal(guardExchangeTimeEvidence(p,[message]).exchangePlan.status,'READY');
 assert.equal(guardExchangeTimeEvidence(p,[message,'03日期取消，不再分批']).exchangePlan.status,'UNPLANNED');
});
