import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersistedDiscussionService } from '../src/index.js';

const firstReply = '想先确认：你最想验证什么？\n初步理解：需要先明确目标。\n还需明确：判断标准。';
const secondReply = '当前理解：要检查一项规则。\n建议先测：对比两个输入及其结果。\n请你确认：以哪个结果为准？';
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
        { turnNumber: rounds.length, userInput: rounds.at(-1).userInput } : null }; },
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
    async abandonCaseDiscussionTurn(_token, _chat, _case, turnNumber) {
      rounds[turnNumber - 1].status = 'ABANDONED';
      return { revision: turnNumber };
    },
  };
  const service = createPersistedDiscussionService({ repository, complete: async request => {
    modelCalls.push(request);
    return modelCalls.length === 1 ? firstReply : secondReply;
  } });
  return { service, rounds, modelCalls };
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
        { turnNumber: 1, userInput: rounds[0].userInput } : null }),
    beginCaseDiscussionTurn: async (_token, _chat, _case, turn) => {
      rounds.push({ ...turn, status: 'PENDING' });
      return { turnNumber: 1 };
    },
    finishCaseDiscussionTurn: async (_token, _chat, _case, turn) => {
      rounds[0].status = 'COMPLETE'; return { revision: turn.turnNumber };
    },
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
