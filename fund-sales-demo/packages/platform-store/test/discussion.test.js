import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseRepository } from '../src/index.js';

const token = 'a'.repeat(43);
const chatPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const casePublicId = '15d68e0b-6ae6-4ced-9ad8-9b705c4744ef';
const scope = [token, chatPublicId, casePublicId];
const reply = '想先确认：你想测什么？\n初步理解：目标待明确。\n还需明确：输入条件。';

function fixture({ chat = { id: 41, status: 'ACTIVE' },
  caseRow = { id: 51, status: 'DISCUSSING' }, sop = { id: 61, status: 'PENDING_CONFIRMATION' } } = {}) {
  const calls = [];
  const turns = [];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_chats')) return [[chat]];
    if (sql.includes('FROM cases')) return [[caseRow]];
    if (sql.includes('FROM case_sop_versions')) return [[sop]];
    if (sql.includes('FROM case_discussion_turns')) {
      if (sql.includes('AND turn_number=?')) return [[turns.find(row => row.turn_number === values[3])]];
      return sql.includes('ORDER BY turn_number DESC') ? [[turns.at(-1)]] : [turns];
    }
    if (sql.includes('INSERT INTO case_discussion_turns')) {
      turns.push({ turn_number: values[3], user_text: values[4], assistant_text: null, status: 'PENDING' });
    }
    if (sql.includes('SET assistant_text=?')) {
      const row = turns.find(item => item.turn_number === values[5]);
      row.assistant_text = values[0]; row.status = 'COMPLETE';
    }
    if (sql.includes("SET status='ABANDONED'")) turns.find(item => item.turn_number === values[3]).status = 'ABANDONED';
    if (sql.includes("SET status='DRAFT'")) sop.status = 'DRAFT';
    if (sql.includes("SET status='DISCUSSING'")) caseRow.status = 'DISCUSSING';
    return [{}];
  } };
  return { calls, turns, caseRow, sop,
    repository: createCaseRepository({ transaction: action => action(db) }) };
}

test('user intent is stored before model output; history contains only complete exchanges', async () => {
  const { repository, calls } = fixture();
  assert.deepEqual(await repository.readCaseDiscussion(...scope), { revision: 0, turns: [], pending: null });
  assert.deepEqual(await repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 0, userInput: '  我想确认边界  ' }), { revision: 1, turnNumber: 1 });
  assert.deepEqual(await repository.readCaseDiscussion(...scope),
    { revision: 1, turns: [], pending: { turnNumber: 1, userInput: '我想确认边界' } });
  await assert.rejects(repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 1, userInput: '另一句' }), { code: 'DISCUSSION_IN_PROGRESS' });
  await repository.finishCaseDiscussionTurn(...scope,
    { turnNumber: 1, assistantReply: reply, promptVersion: 'first-node-format-v4' });
  assert.deepEqual(await repository.readCaseDiscussion(...scope), { revision: 1, pending: null, turns: [
    { role: 'user', content: '我想确认边界' }, { role: 'assistant', content: reply },
  ] });
  await assert.rejects(repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 0, userInput: '过期请求' }), { code: 'STALE_DISCUSSION' });
  assert.ok(calls.filter(call => call.sql.includes('FROM case_discussion_turns'))
    .every(call => call.values[0] === 31 && call.values[1] === 41 && call.values[2] === 51));
});

test('submitting a revision invalidates the pending Plan before confirmation can lock it', async () => {
  const { repository, caseRow, sop, calls } = fixture({ caseRow: { id: 51, status: 'SOP_PENDING' } });
  await repository.beginCaseDiscussionTurn(...scope, { expectedRevision: 0, userInput: '这里要修改' });
  assert.equal(caseRow.status, 'DISCUSSING');
  assert.equal(sop.status, 'DRAFT');
  await assert.rejects(repository.confirmSopProposal(...scope, 1), { code: 'INVALID_CASE_STATE' });
  assert.ok(calls.some(call => call.sql.includes('USER_REVISED_PLAN') && call.values.at(-1) === 7));
});

test('a pending response blocks a new Plan; abandoning it permits another turn', async () => {
  const { repository } = fixture();
  await repository.beginCaseDiscussionTurn(...scope, { expectedRevision: 0, userInput: '先讨论' });
  const plan = { objective: '检查规则', preconditions: [], scenarios: [
    { title: '边界', setup: '准备数据', action: '执行', expected: '可观察结果', evidence: '记录' },
  ], openQuestions: [] };
  await assert.rejects(repository.saveSopProposal(...scope, plan), { code: 'DISCUSSION_IN_PROGRESS' });
  await repository.abandonCaseDiscussionTurn(...scope, 1);
  assert.deepEqual(await repository.readCaseDiscussion(...scope), { revision: 1, turns: [], pending: null });
  await repository.beginCaseDiscussionTurn(...scope, { expectedRevision: 1, userInput: '重新讨论' });
  assert.deepEqual((await repository.readCaseDiscussion(...scope)).pending,
    { turnNumber: 2, userInput: '重新讨论' });
});

test('closed Chat, foreign Case, and locked SOP block discussion requests', async () => {
  for (const [options, code] of [
    [{ chat: { id: 41, status: 'FORCE_CLOSED' } }, 'CHAT_CLOSED'],
    [{ caseRow: null }, 'CASE_NOT_FOUND'],
    [{ caseRow: { id: 51, status: 'SOP_LOCKED' } }, 'INVALID_CASE_STATE'],
  ]) {
    const { repository, calls } = fixture(options);
    await assert.rejects(repository.beginCaseDiscussionTurn(...scope,
      { expectedRevision: 0, userInput: '继续' }), { code });
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO case_discussion_turns')), false);
  }
});
