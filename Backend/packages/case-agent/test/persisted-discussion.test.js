import { planContract } from './plan-contract-fixture.js';
import { exchangePlan } from './exchange-plan-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersistedDiscussionService } from '../src/index.js';

const firstReply = '想先确认：你最想验证什么？\n初步理解：需要先明确目标。\n还需明确：判断标准。';
const secondReply = '当前理解：要检查一项规则。\n建议先测：对比两个输入及其结果。\n请你确认：以哪个结果为准？';
const plan = { objective: '检查规则', preconditions: [], scenarios: [
  { title: '边界', setup: '准备两组数据', action: '分别执行', expected: '确认状态CONFIRMED，结果可比较', evidence: '记录结果' },
], openQuestions: [], exchangePlan };
const scope = { token: 'session', chatPublicId: 'chat', casePublicId: 'case' };

function fixture() {
  const rounds = [];
  const modelCalls = [];
  const repository = {
    async readCaseDiscussion() { return { revision: rounds.length,
      turns: rounds.filter(round => round.status === 'COMPLETE').flatMap(round => [
        { role: 'user', content: round.userInput }, { role: 'assistant', content: round.assistantReply },
      ]),
      pending: rounds.at(-1)?.status === 'PENDING' ?
        { turnNumber: rounds.length, userInput: rounds.at(-1).userInput,
          kind: rounds.at(-1).kind ?? 'DISCUSS' } : null }; },
    async beginCaseDiscussionTurn(_token, _chat, _case, turn) {
      assert.equal(turn.expectedRevision, rounds.length);
      rounds.push({ ...turn, status: 'PENDING' });
      return { revision: rounds.length, turnNumber: rounds.length };
    },
    async finishCaseDiscussionTurn(_token, _chat, _case, turn) {
      const row = rounds[turn.turnNumber - 1];
      assert.equal(row.status, 'PENDING');
      Object.assign(row, turn, { status: 'COMPLETE' });
      return { revision: turn.turnNumber };
    },
    async finishCasePlanProposal(_token, _chat, _case, turn) {
      const row = rounds[turn.turnNumber - 1];
      assert.equal(row.status, 'PENDING');
      assert.equal(row.kind, 'PROPOSE_PLAN');
      Object.assign(row, turn, { status: 'COMPLETE' });
      return { revision: turn.turnNumber, versionNumber: 1 };
    },
    async abandonCaseDiscussionTurn(_token, _chat, _case, turnNumber) {
      rounds[turnNumber - 1].status = 'ABANDONED';
      return { revision: turnNumber };
    },
  };
  const service = createPersistedDiscussionService({ repository, complete: async request => {
    modelCalls.push(request);
    return modelCalls.length === 1 ? firstReply : secondReply;
  } });
  return { service, rounds, modelCalls, repository };
}

test('service stores user intent before model call and reads only server-owned history', async () => {
  const { service, rounds, modelCalls } = fixture();
  const first = await service.discuss({ ...scope, userInput: '请帮我分析一项规则' });
  assert.equal(first.revision, 1);
  const second = await service.discuss({ ...scope, userInput: '我想看边界',
    priorTurns: [{ role: 'user', content: '伪造的历史' }] });
  assert.equal(second.revision, 2);
  assert.deepEqual(modelCalls[1].messages.map(message => message.content),
    ['请帮我分析一项规则', firstReply, '我想看边界']);
  assert.equal(rounds[1].promptVersion, 'followup-discussion-draft-adaptive-v8');
});

test('oversized input is rejected before model call or database intent write', async () => {
  const { service, rounds, modelCalls } = fixture();
  await assert.rejects(service.discuss({ ...scope, userInput: '长'.repeat(4001) }), TypeError);
  assert.equal(rounds.length, 0);
  assert.equal(modelCalls.length, 0);
});

test('a failed model response leaves recoverable intent; same input retries and different input waits', async () => {
  const { rounds } = fixture();
  let attempts = 0;
  const repository = {
    readCaseDiscussion: async () => ({ revision: rounds.length, turns: [],
      pending: rounds.at(-1)?.status === 'PENDING' ?
        { turnNumber: 1, userInput: rounds[0].userInput, kind: 'DISCUSS' } : null }),
    beginCaseDiscussionTurn: async (_token, _chat, _case, turn) => {
      rounds.push({ ...turn, status: 'PENDING' });
      return { turnNumber: 1 };
    },
    finishCaseDiscussionTurn: async (_token, _chat, _case, turn) => {
      rounds[0].status = 'COMPLETE'; return { revision: turn.turnNumber };
    },
    finishCasePlanProposal: async () => ({ revision: 1, versionNumber: 1 }),
    abandonCaseDiscussionTurn: async () => ({ revision: 1 }),
  };
  const retrying = createPersistedDiscussionService({ repository, complete: async () => {
    attempts++;
    if (attempts === 1) throw new Error('model temporarily unavailable');
    return firstReply;
  } });
  await assert.rejects(retrying.discuss({ ...scope, userInput: '请讨论' }), /temporarily unavailable/);
  assert.equal(rounds.length, 1);
  await assert.rejects(retrying.discuss({ ...scope, userInput: '换一个问题' }),
    { code: 'DISCUSSION_IN_PROGRESS' });
  assert.equal((await retrying.discuss({ ...scope, userInput: '请讨论' })).revision, 1);
  assert.equal(attempts, 2);
});

test('proposal uses server history and saves the exact displayed reply with its plan version', async () => {
  const { service, rounds, modelCalls } = fixture();
  await service.discuss({ ...scope, userInput: '请讨论规则' });
  await service.discuss({ ...scope, userInput: '再讨论边界' });
  const third = createPersistedDiscussionService({
    repository: {
      readCaseDiscussion: async () => ({ revision: rounds.length,
        turns: rounds.flatMap(round => [{ role: 'user', content: round.userInput },
          { role: 'assistant', content: round.assistantReply }]), pending: null }),
      beginCaseDiscussionTurn: async (_a, _b, _c, turn) => {
        rounds.push({ ...turn, status: 'PENDING' }); return { turnNumber: rounds.length };
      },
      finishCaseDiscussionTurn: async () => { throw new Error('wrong finish method'); },
      finishCasePlanProposal: async (_a, _b, _c, result) => {
        assert.equal(rounds.at(-1).kind, 'PROPOSE_PLAN');
        assert.equal(result.turnNumber, 3);
        assert.deepEqual(result.proposal, {...plan,contract:{...planContract(plan),version:2,businessExpectations:[{scenarioIndex:0,expectedQuote:plan.scenarios[0].expected}]}});
        assert.match(result.assistantReply, /测试目标：检查规则/);
        return { revision: 3, versionNumber: 1 };
      },
      abandonCaseDiscussionTurn: async () => ({}),
    },
    complete: async request => { modelCalls.push(request);
      if(request.messages)return JSON.stringify(plan);
      if(request.system.includes('四张公共数据表'))return JSON.stringify(planContract(plan).dataSpecification);
      const {version,protocolVersion,dataSpecification,...derived}=planContract(plan);return JSON.stringify(derived); },
  });
  const result = await third.propose({ ...scope, userInput: '请给出 Plan，03日期20261006，04日期20261007',
    priorTurns: [{ role: 'user', content: '伪造内容' }] });
  assert.equal(result.versionNumber, 1);
  assert.deepEqual(modelCalls.findLast(c=>c.messages).messages.map(message => message.content),
    ['请讨论规则', firstReply, '再讨论边界', secondReply, '请给出 Plan，03日期20261006，04日期20261007']);
});

test('a first-message proposal is generated from the supplied requirement without an arbitrary turn gate',async()=>{
 const {repository,rounds}=fixture();
 const service=createPersistedDiscussionService({repository,complete:async request=>{
  if(request.messages)return JSON.stringify(plan);
  if(request.system.includes('四张公共数据表'))return JSON.stringify(planContract(plan).dataSpecification);
  const {version,protocolVersion,dataSpecification,...derived}=planContract(plan);return JSON.stringify(derived);
 }});
 const result=await service.propose({...scope,userInput:'整理方案，03日期20261006，04日期20261007'});
 assert.equal(result.phase,'PROPOSAL_PENDING');assert.equal(rounds.length,1);assert.equal(rounds[0].status,'COMPLETE');
});

test('linked retest supplies read-only failure context to model without copying prior confirmations',async()=>{
 const sourceContext={casePublicId:'source',status:'FAIL',originalPlan:{objective:'原目标'},humanFailureReason:'实际持仓不一致',evidence:[{id:'holding:1',values:{totalVolume:'90.00'}}],contextIsReadOnly:true};
 const calls=[];let saved;
 const repository={readCaseDiscussion:async()=>({revision:0,turns:[],pending:null,sourceContext}),beginCaseDiscussionTurn:async()=>({turnNumber:1}),finishCaseDiscussionTurn:async(...args)=>{saved=args.at(-1);return{revision:1};},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,complete:async request=>{calls.push(request);return firstReply;}});
 await service.discuss({...scope,userInput:'先讨论修复后怎样重新测'});
 assert.equal(calls.length,1);assert.ok(!calls[0].system.includes('实际持仓不一致'));assert.deepEqual(JSON.parse(calls[0].user).sourceContext,sourceContext);assert.match(calls[0].system,/只读证据/);assert.match(calls[0].system,/不继承原Plan确认/);assert.equal(JSON.parse(calls[0].user).userInput,'先讨论修复后怎样重新测');assert.equal(saved.turnNumber,1);
});


test('sealed Chat rejects a pending-turn retry before any model call',async()=>{
 let calls=0;
 const repository={assertCaseWritable:async()=>{throw Object.assign(new Error('已封存'),{code:'CASE_NOT_WRITABLE'});},readCaseDiscussion:async()=>({revision:1,turns:[],pending:{turnNumber:1,userInput:'重试',kind:'DISCUSS'}}),beginCaseDiscussionTurn:async()=>{},finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,complete:async()=>{calls++;return firstReply;}});
 await assert.rejects(service.discuss({...scope,userInput:'重试'}),{code:'CASE_NOT_WRITABLE'});assert.equal(calls,0);
});

for (const invalidStage of ['DATA_SPEC_INVALID', 'INVALID_PLAN_CONTRACT']) {
  test(`${invalidStage} saves an explicitly incomplete draft so the user can correct or retry`, async () => {
    const { service, repository, rounds } = fixture();
    await service.discuss({ ...scope, userInput: '请讨论规则' });
    await service.discuss({ ...scope, userInput: '再讨论边界' });
    let invalid = true;
    const proposing = createPersistedDiscussionService({ repository, complete: async request => {
      if (request.messages) return JSON.stringify(plan);
      const dataStage = request.system.includes('四张公共数据表');
      if (invalid && dataStage === (invalidStage === 'DATA_SPEC_INVALID')) return '{}';
      if (dataStage) return JSON.stringify(planContract(plan).dataSpecification);
      const { version, protocolVersion, dataSpecification, ...derived } = planContract(plan);
      return JSON.stringify(derived);
    } });
    const draft=await proposing.propose({ ...scope, userInput: '请生成Plan，03日期20261006，04日期20261007' });
    assert.equal(draft.phase,'DRAFT_PENDING');
    assert.equal(rounds.at(-1).status, 'COMPLETE');
    assert.equal(rounds.at(-1).draft,true);
    assert.equal(draft.proposal.contract,undefined);
    invalid = false;
    const result = await proposing.propose({ ...scope, userInput: '修正后的Plan请求，03日期20261006，04日期20261007' });
    assert.equal(result.versionNumber, 1);
    assert.equal(rounds.at(-1).status, 'COMPLETE');
  });
}

test('temporary contract model failure retains the same proposal intent for retry', async () => {
  const { service, repository, rounds } = fixture();
  await service.discuss({ ...scope, userInput: '请讨论规则' });
  await service.discuss({ ...scope, userInput: '再讨论边界' });
  let unavailable = true;
  const proposing = createPersistedDiscussionService({ repository, complete: async request => {
    if (request.messages) return JSON.stringify(plan);
    if (unavailable) throw new Error('model temporarily unavailable');
    if (request.system.includes('四张公共数据表')) return JSON.stringify(planContract(plan).dataSpecification);
    const { version, protocolVersion, dataSpecification, ...derived } = planContract(plan);
    return JSON.stringify(derived);
  } });
  await assert.rejects(proposing.propose({ ...scope, userInput: '请生成Plan，03日期20261006，04日期20261007' }), /temporarily unavailable/);
  assert.equal(rounds.at(-1).status, 'PENDING');
  await assert.rejects(proposing.propose({ ...scope, userInput: '另一个请求' }), { code: 'DISCUSSION_IN_PROGRESS' });
  unavailable = false;
  await proposing.propose({ ...scope, userInput: '请生成Plan，03日期20261006，04日期20261007' });
  assert.equal(rounds.length, 3);
  assert.equal(rounds.at(-1).status, 'COMPLETE');
});


test('a completed proposal request replays its saved version without another model call',async()=>{
 const history={revision:5,pending:null,turns:[{role:'user',content:'请整理方案'},{role:'assistant',content:'保存的提案回复'}]};
 const repository={readCaseDiscussion:async()=>history,getLatestSopProposal:async()=>({sourceTurnNumber:5,versionNumber:1,status:'PENDING_CONFIRMATION',proposal:plan}),
 beginCaseDiscussionTurn:async()=>{throw new Error('must not create another turn');},finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,complete:async()=>{throw new Error('must not call model');}});
 const result=await service.propose({...scope,userInput:'请整理方案'});
 assert.equal(result.replayed,true);assert.equal(result.versionNumber,1);assert.equal(result.revision,5);assert.equal(result.reply,'保存的提案回复');
});

test('same text with a new image does not replay the saved proposal',async()=>{
 const {repository}=fixture();
 repository.readCaseDiscussion=async()=>({revision:5,pending:null,turns:[{role:'user',content:'请整理方案'},{role:'assistant',content:'旧方案'}]});
 repository.getLatestSopProposal=async()=>({sourceTurnNumber:5,status:'PENDING_CONFIRMATION',proposal:plan});
 repository.beginCaseDiscussionTurn=async()=>({turnNumber:6,revision:6});
 let visionCalls=0;
 const service=createPersistedDiscussionService({repository,complete:async()=>{throw new Error('new proposal model reached');},visionComplete:async()=>{visionCalls++;return '新附件内容';}});
 await assert.rejects(service.propose({...scope,userInput:'请整理方案',images:[{name:'new.png',dataUrl:'data:image/png;base64,iVBORw0KGgo='}]}),/new proposal model reached/);
 assert.equal(visionCalls,1);
});

test('streamed discussion carries verified saved-plan context through validation and persistence', async () => {
  const { repository, rounds } = fixture();
  repository.getLatestSopProposal = async () => ({ versionNumber: 1 });
  const deltas = [], controller = new AbortController();
  const reply = '方案已生成，可在测试方案中查看并修改。下一步：审阅准备数据。';
  const service = createPersistedDiscussionService({ repository, complete: async request => {
    assert.equal(request.signal, controller.signal);
    assert.match(request.system, /系统已核实当前Case存在方案/);
    request.onDelta(reply);
    return reply;
  } });
  const result = await service.discuss({ ...scope, userInput: '下一步是什么？',
    signal: controller.signal, onDelta: delta => deltas.push(delta) });
  assert.deepEqual(deltas, [reply]);
  assert.equal(result.reply, reply);
  assert.equal(rounds[0].assistantReply, reply);
  assert.equal(rounds[0].status, 'COMPLETE');
});

const routeMessage=(intent,nextAction=null,needsClarification=false)=>({tool_calls:[{function:{name:'route_action',arguments:JSON.stringify({intent,nextAction,needsClarification,reason:'依据本轮语义和上下文'})}}]});
test('next-step inquiry sees the existing reviewable plan instead of turning it into a draft',async()=>{
 const {repository,rounds}=fixture();let status='PENDING_CONFIRMATION',calls=0;
 const begin=repository.beginCaseDiscussionTurn;
 repository.getLatestSopProposal=async()=>({status,proposal:plan});
 repository.beginCaseDiscussionTurn=async(...args)=>{if(!args[3].preservePlan)status='DRAFT';return begin(...args);};
 const service=createPersistedDiscussionService({repository,routeComplete:async request=>{
  assert.ok(JSON.parse(request.user).allowedActions.includes('INSPECT_PLAN'));return routeMessage('INSPECT_PLAN');
 },readContext:async()=>({stage:'CONFIRM_PLAN_DATA',plan:{status},exchange:{status:'READY'}}),complete:async request=>{
  calls++;assert.match(request.system,/系统已核实当前Case存在方案/);
  const context=JSON.parse(request.user);assert.equal(context.currentCase.plan.status,'PENDING_CONFIRMATION');
  return '方案已可审阅，请打开测试方案查看准备数据，并点击确认准备数据。';
 }});
 await service.respond({...scope,userInput:'下一步是什么？'});
 assert.equal(calls,1);assert.equal(status,'PENDING_CONFIRMATION');assert.equal(rounds[0].preservePlan,true);
});

test('a condition change still invalidates the reviewable plan before answering',async()=>{
 const {repository,rounds}=fixture();
 const service=createPersistedDiscussionService({repository,routeComplete:async()=>routeMessage('DISCUSS'),complete:async()=>firstReply});
 await service.respond({...scope,userInput:'把金额改成3000，先别整理'});
 assert.equal(rounds[0].preservePlan,false);
});

test('retrying a failed read-only inquiry preserves the plan without routing or beginning another turn',async()=>{
 const {repository,rounds}=fixture();let routed=0,attempts=0;
 repository.getLatestSopProposal=async()=>({status:'PENDING_CONFIRMATION',proposal:plan});
 const service=createPersistedDiscussionService({repository,routeComplete:async()=>{routed++;return routeMessage('INSPECT_PLAN');},complete:async()=>{
  if(++attempts===1)throw Object.assign(new Error('temporary failure'),{code:'MODEL_UNAVAILABLE'});
  return '请打开测试方案审阅准备数据，并点击确认准备数据。';
 }});
 await assert.rejects(service.respond({...scope,userInput:'下一步是什么？'}),{code:'MODEL_UNAVAILABLE'});
 assert.equal(rounds[0].preservePlan,true);assert.equal(rounds[0].status,'PENDING');
 await service.respond({...scope,userInput:'下一步是什么？'});
 assert.equal(rounds.length,1);assert.equal(routed,1);assert.equal(rounds[0].status,'COMPLETE');
});
test('ordinary chat routes to an actual proposal and keeps compound modifications in the generation input',async()=>{
 const {repository,rounds}=fixture();let routed,generated;
 const service=createPersistedDiscussionService({repository,routeComplete:async request=>{routed=JSON.parse(request.user);return routeMessage('PROPOSE_PLAN');},complete:async request=>{
  if(request.messages){generated=request.messages;return JSON.stringify(plan);}
  if(request.system.includes('四张公共数据表'))return JSON.stringify(planContract(plan).dataSpecification);
  const {version,protocolVersion,dataSpecification,...derived}=planContract(plan);return JSON.stringify(derived);
 }});
 const userInput='金额改成3000，然后整理方案。03日期20261006，04日期20261007';
 const result=await service.respond({...scope,userInput});
 assert.equal(result.phase,'PROPOSAL_PENDING');assert.equal(routed.userInput,userInput);assert.equal(generated.at(-1).content,userInput);assert.equal(rounds[0].kind,'PROPOSE_PLAN');
});

test('regeneration carries current business content and ordinary discussion without recycling old generated contracts',async()=>{
 const {repository}=fixture();
 const latest={...plan,preconditions:['保留已讨论的业务条件']};
 repository.getLatestSopProposal=async()=>({status:'DRAFT',proposal:latest,sourceTurnNumber:1});
 repository.readCaseDiscussion=async()=>({revision:0,pending:null,turns:[
  {role:'user',content:'原始业务要求，03日期20261006，04日期20261007'},
  {role:'assistant',kind:'PROPOSE_PLAN',content:'旧生成失败：技术字段和旧契约不应当成为新业务要求'},
  {role:'user',content:'补充业务规则'},
  {role:'assistant',content:'普通讨论里的业务说明仍应承接'},
 ]});
 const service=createPersistedDiscussionService({repository,complete:async request=>{
  if(request.messages){
   assert.ok(request.messages.every(t=>!t.content.includes('旧契约')&&!t.content.includes('历史方案已保留')));
   assert.ok(request.messages.some(t=>t.content==='原始业务要求，03日期20261006，04日期20261007'));
   assert.ok(request.messages.some(t=>t.content==='普通讨论里的业务说明仍应承接'));
   const input=JSON.parse(request.messages.at(-1).content);
   assert.equal(input.userInput,'请整理当前方案');assert.deepEqual(input.currentProposal,{objective:latest.objective,preconditions:latest.preconditions,scenarios:latest.scenarios,exchangePlan:latest.exchangePlan,openQuestions:latest.openQuestions});
   return JSON.stringify(plan);
  }
  if(request.system.includes('四张公共数据表'))return JSON.stringify(planContract(plan).dataSpecification);
  assert.ok(JSON.parse(request.user).discussionContext.every(t=>t.role==='user'));
  const {version,protocolVersion,dataSpecification,...derived}=planContract(plan);return JSON.stringify(derived);
 }});
 assert.equal((await service.propose({...scope,userInput:'请整理当前方案'})).phase,'PROPOSAL_PENDING');
});
test('explicit persisted next action reaches router and cancellation never calls proposal generation',async()=>{
 const {repository,rounds}=fixture();repository.readCaseDiscussion=async()=>({revision:0,turns:[],pending:null,nextAction:'PROPOSE_PLAN'});
 const service=createPersistedDiscussionService({repository,routeComplete:async request=>{assert.equal(JSON.parse(request.user).pendingNextAction,'PROPOSE_PLAN');return routeMessage('DISCUSS');},complete:async request=>{assert.ok(!request.system.includes('exchangePlan字段'));return firstReply;}});
 await service.respond({...scope,userInput:'先别整理，只解释一下'});assert.equal(rounds[0].kind,undefined);
});
test('same Case concurrent turns are rejected before a second model call; stale routing cannot write',async()=>{
 const {repository}=fixture();let release,started;const ready=new Promise(resolve=>started=resolve);
 const service=createPersistedDiscussionService({repository,routeComplete:async()=>{if(!release){started();await new Promise(resolve=>release=resolve);}return routeMessage('DISCUSS');},complete:async()=>firstReply});
 const first=service.respond({...scope,userInput:'讨论规则'});await ready;
 await assert.rejects(service.respond({...scope,userInput:'另一条'}),{code:'DISCUSSION_IN_PROGRESS'});release();await first;
 let reads=0;const original=repository.readCaseDiscussion;repository.readCaseDiscussion=async(...args)=>({...await original(...args),revision:++reads});
 await assert.rejects(service.respond({...scope,userInput:'讨论规则'}),{code:'STALE_DISCUSSION'});
});
test('unplanned file timing persists a draft without invoking data or expectation generation',async()=>{
 const {repository,rounds}=fixture();let calls=0;
 const draft={...plan,exchangePlan:{status:'UNPLANNED',steps:[],openQuestions:['实际业务日期尚待确定']}};
 const service=createPersistedDiscussionService({repository,complete:async()=>{calls++;return JSON.stringify(draft);}});
 const result=await service.propose({...scope,userInput:'先整理已有内容，实际日期待定'});
 assert.equal(calls,1);assert.equal(result.phase,'DRAFT_PENDING');assert.equal(rounds[0].draft,true);assert.equal(result.proposal.contract,undefined);
});

test('an upstream package dependency error repairs the plan once and reuses prepared data',async()=>{
 const {indexedPlan}=await import('./indexed-package-fixture.js');
 const full=indexedPlan({accounts:1,rounds:1}),{contract,...correct}=full;
 const broken=structuredClone(correct);
 const trade=broken.exchangePlan.steps.find(s=>s.fileType==='03');
 const received=broken.exchangePlan.steps.find(s=>s.fileType==='02');
 received.dependsOn=[{stepId:'open',condition:'SENT'}];trade.dependsOn=[{stepId:received.stepId,condition:'CONFIRMED'}];
 let plans=0,dataCalls=0,contracts=0;
 const {repository}=fixture();
 const service=createPersistedDiscussionService({repository,complete:async request=>{
  if(request.messages){plans++;if(plans===2){assert.match(request.system,/proposalRepair/);assert.ok(JSON.parse(request.messages.at(-1).content).proposalRepair.validationIssues.length);}return JSON.stringify(plans===1?broken:correct);}
  if(request.system.includes('四张公共数据表')){dataCalls++;return JSON.stringify(contract.dataSpecification);}
  contracts++;const {version,protocolVersion,dataSpecification,businessExpectations,...derived}=contract;return JSON.stringify(derived);
 }});
 const result=await service.propose({...scope,userInput:'整理同包开户申购草稿，所有文件业务日期20261008'});
 assert.equal(result.phase,'PROPOSAL_PENDING');assert.equal(plans,2);assert.equal(dataCalls,1);assert.equal(contracts,2);assert.deepEqual(result.proposal.exchangePlan.steps.find(s=>s.fileType==='03').dependsOn,[]);
});
