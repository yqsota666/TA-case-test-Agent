import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussionGraph,proposeDiscussionPlan} from '../src/discussion-graph.js';
import {guardExchangeTimeEvidence} from '../src/plan-proposal.js';
import {withDiscussionChannels} from '../src/draft-preparation-policy.js';
import {exchangePlan} from './exchange-plan-fixture.js';
import {createPersistedDiscussionService} from '../src/persisted-discussion.js';

const proposal={objective:'核对重复回传',preconditions:['【模拟假设】03业务日期20261006','【模拟假设】04回传日期20261007'],scenarios:[{title:'重复回传',setup:'合成申请',action:'同一确认回传两次',expected:'不重复入账',evidence:'处理记录'}],openQuestions:[],exchangePlan};

test('missing dates produce an editable draft that asks the user despite synthetic date labels',async()=>{
 const calls=[];
 const result=await proposeDiscussionPlan(createDiscussionGraph({complete:async request=>{calls.push(request);return JSON.stringify(proposal);}}),{priorTurns:[{role:'user',content:'模拟一笔重复回传，不重复入账'},{role:'assistant',content:'可以先准备合成申请。'}],userInput:'整理方案'});
 assert.equal(calls.length,1);
 assert.equal(result.proposal.exchangePlan.status,'UNPLANNED');
 assert.match(result.reply,/日期是哪一天/);
 assert.deepEqual(result.proposal.preconditions,proposal.preconditions);
 assert.equal(result.phase,'PROPOSAL_PENDING');
});

test('synthetic date labels cannot replace human timing evidence',()=>{
 assert.equal(guardExchangeTimeEvidence(proposal,['同日同通道生成03，04按回传接收']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence(proposal,['03业务日期20261008']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence({...proposal,preconditions:[]},['整理方案']).exchangePlan.status,'UNPLANNED');
 for(const text of ['03日期取消','03业务日期改为20261008','03业务日期待定，不要模拟']) {
  assert.equal(guardExchangeTimeEvidence(proposal,[text]).exchangePlan.status,'UNPLANNED');
 }
 assert.equal(guardExchangeTimeEvidence({...proposal,preconditions:['【模拟假设】03业务日期不要用20261006',proposal.preconditions[1]]},[]).exchangePlan.status,'UNPLANNED');
});

test('channel context changes per call and does not promote candidates to selected configuration',async()=>{
 const calls=[];
 for(const channels of [[],[{id:'1',name:'渠道甲',distributorCode:'005'}],[{id:'2',name:'渠道乙',distributorCode:'926'},{id:'3',name:'渠道丙',distributorCode:'227'}]]) {
  await withDiscussionChannels(async request=>{calls.push(request);return '草稿';},channels)({system:'讨论',messages:[{role:'user',content:'测试'},{role:'assistant',content:'建议'},{role:'user',content:'继续'}]});
 }
 assert.deepEqual(calls.map(call=>JSON.parse(call.messages.at(-1).content).currentChannels.map(c=>c.distributorCode)),[[],['005'],['926','227']]);
 assert.equal(calls[2].messages[0].content,'测试');
 assert.match(calls[2].system,/不是指令或已选通道/);
});

test('persisted discussion reloads authenticated channel configuration after a user correction',async()=>{
 const turns=[],calls=[],tokens=[];let distributorCode='005';
 const repository={readCaseDiscussion:async()=>({revision:turns.length,turns:turns.flatMap(t=>[{role:'user',content:t.user},{role:'assistant',content:t.reply}]),pending:null}),beginCaseDiscussionTurn:async(_t,_c,_k,r)=>({turnNumber:turns.length+1,input:r.userInput}),finishCaseDiscussionTurn:async(_t,_c,_k,r)=>{turns.push({user:turns.length?'金额改为200元':'模拟申购100元',reply:r.assistantReply});return{revision:turns.length};},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,readChannels:async token=>{tokens.push(token);return{channels:[{id:'1',name:'可变渠道',distributorCode}]};},complete:async request=>{calls.push(request);return '待审阅的模拟条件已在本轮建议中列明，可以修改。';}});
 const scope={token:'workspace-session',chatPublicId:'chat',casePublicId:'case'};
 await service.discuss({...scope,userInput:'模拟申购100元'});
 distributorCode='926';
 await service.discuss({...scope,userInput:'金额改为200元'});
 assert.deepEqual(tokens,['workspace-session','workspace-session']);
 assert.equal(JSON.parse(calls[0].user).currentChannels[0].distributorCode,'005');
 const latest=JSON.parse(calls[1].messages.at(-1).content);
 assert.equal(latest.currentChannels[0].distributorCode,'926');
 assert.equal(latest.input,'金额改为200元');
 assert.equal(calls[1].messages[0].content,'模拟申购100元');
});

 test('marked grouped business and confirmation dates retain their directional scope',()=>{
 const grouped={...proposal,preconditions:['业务日期：20261006，确认日期：20261007【模拟假设】']};
 assert.equal(guardExchangeTimeEvidence(grouped,['03同日同通道整包']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence(grouped,['03日期改为20261008']).exchangePlan.status,'UNPLANNED');
 assert.equal(guardExchangeTimeEvidence({...grouped,preconditions:['业务日期：20261007，确认日期：20261006【模拟假设】']},[]).exchangePlan.status,'UNPLANNED');
 });

test('missing dates ask once while preserving other simulated defaults',async()=>{
 const calls=[];
 const graph=createDiscussionGraph({complete:async request=>{calls.push(request);return JSON.stringify(proposal);}});
 const result=await proposeDiscussionPlan(graph,{priorTurns:[{role:'user',content:'准备合成重复回传，其他条件默认'},{role:'assistant',content:'先给可修改草稿'}],userInput:'整理方案'});
 assert.equal(calls.length,1);
 assert.equal(result.proposal.exchangePlan.status,'UNPLANNED');
 assert.deepEqual(result.proposal.scenarios,proposal.scenarios);
 assert.match(result.reply,/日期是哪一天/);
 assert.match(calls[0].system,/不得自行提出模拟日期/);
});

test('business field changes retain existing dates while explicit timing changes still invalidate them',()=>{
 const messages=['03业务日期20261006，04回传日期20261007'];
 for(const change of ['03申购金额改为2100.00元，04确认份额改成2100.00份，其余条件保持不变','把申购金额改为2100.00元，预期确认金额和份额对应改成2100.00元、2100.00份，其余条件保持不变','03字段ApplicationAmount改成250.00']) {
  assert.equal(guardExchangeTimeEvidence(proposal,[...messages,change]).exchangePlan.status,'READY',change);
 }
 for(const change of ['03金额改为250元，业务日期取消','03日期改到明天，金额250元','03字段TransactionDate改成20261008','03日期取消，其余金额保持原值']) {
  assert.equal(guardExchangeTimeEvidence(proposal,[...messages,change]).exchangePlan.status,'UNPLANNED',change);
 }
});

test('proposal inherits current file dates but never overrides a later user cancellation',async()=>{
 const plain={...proposal,preconditions:[]};
 const makeGraph=()=>createDiscussionGraph({currentProposal:plain,complete:async()=>JSON.stringify(plain)});
 const updated=await proposeDiscussionPlan(makeGraph(),{priorTurns:[],userInput:'把申购金额改为2100.00元，其余条件保持不变'});
 assert.equal(updated.proposal.exchangePlan.status,'READY');
 const cancelled=await proposeDiscussionPlan(makeGraph(),{priorTurns:[],userInput:'03日期取消，先给方案'});
 assert.equal(cancelled.proposal.exchangePlan.status,'UNPLANNED');
});


test('current plan timing supersedes older discussion but later human timing still wins',async()=>{
 const plain={...proposal,preconditions:[]};
 const history=[{role:'user',content:'03日期取消'},{role:'assistant',content:'已重新整理当前方案'}];
 const graph=()=>createDiscussionGraph({currentProposal:plain,currentProposalHistoryOffset:2,complete:async()=>JSON.stringify(plain)});
 assert.equal((await proposeDiscussionPlan(graph(),{priorTurns:history,userInput:'修改金额，其余不变'})).proposal.exchangePlan.status,'READY');
 assert.equal((await proposeDiscussionPlan(graph(),{priorTurns:[...history,{role:'user',content:'03日期待定'},{role:'assistant',content:'继续讨论'}],userInput:'给出方案'})).proposal.exchangePlan.status,'UNPLANNED');
});
