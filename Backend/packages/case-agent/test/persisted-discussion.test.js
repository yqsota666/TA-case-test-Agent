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
  assert.equal(rounds[1].promptVersion, 'followup-discussion-v3');
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
        assert.deepEqual(result.proposal, {...plan,contract:planContract(plan)});
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

test('premature proposal is rejected before creating a pending turn', async () => {
  const { service, rounds } = fixture();
  await assert.rejects(service.propose({ ...scope, userInput: '现在生成 Plan' }), /至少需要两轮/);
  assert.equal(rounds.length, 0);
});


test('linked retest supplies read-only failure context to model without copying prior confirmations',async()=>{
 const sourceContext={casePublicId:'source',status:'FAIL',originalPlan:{objective:'原目标'},humanFailureReason:'实际持仓不一致',evidence:[{id:'holding:1',values:{totalVolume:'90.00'}}],contextIsReadOnly:true};
 const calls=[];let saved;
 const repository={readCaseDiscussion:async()=>({revision:0,turns:[],pending:null,sourceContext}),beginCaseDiscussionTurn:async()=>({turnNumber:1}),finishCaseDiscussionTurn:async(...args)=>{saved=args.at(-1);return{revision:1};},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,complete:async request=>{calls.push(request);return firstReply;}});
 await service.discuss({...scope,userInput:'先讨论修复后怎样重新测'});
 assert.equal(calls.length,1);assert.match(calls[0].system,/实际持仓不一致/);assert.match(calls[0].system,/只读证据/);assert.match(calls[0].system,/不继承原Plan确认/);assert.equal(calls[0].user,'先讨论修复后怎样重新测');assert.equal(saved.turnNumber,1);
});


test('sealed Chat rejects a pending-turn retry before any model call',async()=>{
 let calls=0;
 const repository={assertCaseWritable:async()=>{throw Object.assign(new Error('已封存'),{code:'CASE_NOT_WRITABLE'});},readCaseDiscussion:async()=>({revision:1,turns:[],pending:{turnNumber:1,userInput:'重试',kind:'DISCUSS'}}),beginCaseDiscussionTurn:async()=>{},finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,complete:async()=>{calls++;return firstReply;}});
 await assert.rejects(service.discuss({...scope,userInput:'重试'}),{code:'CASE_NOT_WRITABLE'});assert.equal(calls,0);
});

for (const invalidStage of ['DATA_SPEC_INVALID', 'INVALID_PLAN_CONTRACT']) {
  test(`${invalidStage} releases proposal intent so the user can correct the request`, async () => {
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
    await assert.rejects(proposing.propose({ ...scope, userInput: '请生成Plan，03日期20261006，04日期20261007' }), { code: invalidStage });
    assert.equal(rounds.at(-1).status, 'ABANDONED');
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
