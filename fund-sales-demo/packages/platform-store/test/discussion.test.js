import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseRepository } from '../src/index.js';

const token = 'a'.repeat(43);
const chatPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const casePublicId = '15d68e0b-6ae6-4ced-9ad8-9b705c4744ef';
const scope = [token, chatPublicId, casePublicId];
const reply = '想先确认：你想测什么？\n初步理解：目标待明确。\n还需明确：输入条件。';

function fixture({ chat = { id: 41, status: 'ACTIVE' },
  caseRow = { id: 51, status: 'DISCUSSING' }, sop = { id: 61, status: 'PENDING_CONFIRMATION' },
  initialTurns = [] } = {}) {
  const calls = [];
  const turns = [...initialTurns];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_chats')) return [[chat]];
    if (sql.includes('FROM cases')) return [[caseRow]];
    if (sql.includes('FROM case_sop_versions')) return [[sop]];
    if (sql.includes('FROM case_discussion_turns')) {
      if (sql.includes('COUNT(*)')) return [[{ count: turns.filter(row => row.status === 'COMPLETE' &&
        row.turn_number < values[3]).length }]];
      if (sql.includes('AND turn_number=?')) return [[turns.find(row => row.turn_number === values[3])]];
      return sql.includes('ORDER BY turn_number DESC') ? [[turns.at(-1)]] : [turns];
    }
    if (sql.includes('INSERT INTO case_discussion_turns')) {
      turns.push({ turn_number: values[3], user_text: values[4], assistant_text: null,
        status: 'PENDING', turn_kind: values[6] });
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
    { revision: 1, turns: [], pending: { turnNumber: 1, userInput: '我想确认边界', kind: 'DISCUSS' } });
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

test('locked Case history stays readable while new discussion stays blocked', async () => {
  const { repository } = fixture({ caseRow: { id: 51, status: 'SOP_LOCKED' }, initialTurns: [
    { turn_number: 1, user_text: '测试目标', assistant_text: reply, status: 'COMPLETE', turn_kind: 'DISCUSS' },
  ] });
  assert.equal((await repository.readCaseDiscussion(...scope)).turns[1].content, reply);
  await assert.rejects(repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 1, userInput: '再讨论' }), { code: 'INVALID_CASE_STATE' });
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
    { turnNumber: 2, userInput: '重新讨论', kind: 'DISCUSS' });
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

test('a proposal turn and SOP version share one scoped transaction', async () => {
  const previous = [1, 2].map(turn_number => ({ turn_number, user_text: `问题${turn_number}`,
    assistant_text: `回答${turn_number}`, status: 'COMPLETE', turn_kind: 'DISCUSS' }));
  const { repository, calls } = fixture({ initialTurns: previous, sop: null });
  const plan = { objective: '检查规则', preconditions: [], scenarios: [
    { title: '边界', setup: '准备数据', action: '执行', expected: '可观察结果', evidence: '记录' },
  ], openQuestions: [] };
  await repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 2, userInput: '请生成方案', kind: 'PROPOSE_PLAN' });
  await assert.rejects(repository.finishCaseDiscussionTurn(...scope,
    { turnNumber: 3, assistantReply: reply, promptVersion: 'plan-proposal-v1' }),
  { code: 'STALE_DISCUSSION' });
  const saved = await repository.finishCasePlanProposal(...scope,
    { turnNumber: 3, assistantReply: '测试目标：检查规则',
      promptVersion: 'plan-proposal-v1', proposal: plan });
  assert.deepEqual(saved, { revision: 3, versionNumber: 1, status: 'PENDING_CONFIRMATION' });
  const insertion = calls.find(call => call.sql.includes('INSERT INTO case_sop_versions'));
  assert.deepEqual(insertion.values.slice(0, 4), [31, 41, 51, 1]);
  assert.equal(insertion.values.at(-1), 3);
  assert.ok(calls.some(call => call.sql.includes("SET status='SOP_PENDING'")));
  assert.ok(calls.some(call => call.sql.includes('AI_PLAN_PROPOSAL')));
});

test('proposal completion rejects too little discussion before writing a SOP', async () => {
  const { repository, calls } = fixture({ initialTurns: [
    { turn_number: 1, user_text: '问题', assistant_text: '回答', status: 'COMPLETE', turn_kind: 'DISCUSS' },
  ], sop: null });
  await repository.beginCaseDiscussionTurn(...scope,
    { expectedRevision: 1, userInput: '请生成方案', kind: 'PROPOSE_PLAN' });
  const plan = { objective: '检查规则', preconditions: [], scenarios: [
    { title: '边界', setup: '准备数据', action: '执行', expected: '可观察结果', evidence: '记录' },
  ], openQuestions: [] };
  await assert.rejects(repository.finishCasePlanProposal(...scope,
    { turnNumber: 2, assistantReply: '测试目标：检查规则',
      promptVersion: 'plan-proposal-v1', proposal: plan }), { code: 'INSUFFICIENT_DISCUSSION' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO case_sop_versions')), false);
});
