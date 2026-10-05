import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { authenticateSession, createCaseRepository, sessionTokenHash } from '../src/index.js';

const token = 'a'.repeat(43);
const chatId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const auth = { user_id: 7, workspace_id: 31 };

function fixture({ chat, cases = [] } = {}) {
  const calls = [];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[auth]];
    if (sql.includes('FROM case_chats')) return [[chat]];
    if (sql.includes('FROM cases')) return [cases];
    if (sql.includes('INSERT INTO case_chats')) return [{ insertId: 41 }];
    if (sql.includes('INSERT INTO cases')) return [{ insertId: 51 }];
    return [{}];
  } };
  return { calls, db, repository: createCaseRepository({ transaction: action => action(db) }) };
}

test('auth checks a valid session and derives workspace from its owner', async () => {
  const { db, calls } = fixture();
  assert.deepEqual(await authenticateSession(db, token), auth);
  assert.equal(calls[0].values[0], crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(sessionTokenHash(token), calls[0].values[0]);
  assert.match(calls[0].sql, /expires_at>UTC_TIMESTAMP/);
  assert.match(calls[0].sql, /owner_user_id=u\.id/);
});

test('rejects an invalid session before touching the database', async () => {
  const { db, calls } = fixture();
  await assert.rejects(authenticateSession(db, 'invalid'), { code: 'UNAUTHENTICATED' });
  assert.equal(calls.length, 0);
});

test('creating a Chat and Case records their initial state in the same transaction', async () => {
  const { repository, calls } = fixture({ chat: { id: 41, status: 'ACTIVE' } });
  assert.match((await repository.createChat(token, '  测试 Chat  ')).publicId, /^[a-f0-9-]{36}$/);
  assert.match((await repository.createCase(token, chatId, '  边界 Case  ')).publicId, /^[a-f0-9-]{36}$/);
  const createChat = calls.find(call => call.sql.includes('INSERT INTO case_chats'));
  const createCase = calls.find(call => call.sql.includes('INSERT INTO cases'));
  assert.deepEqual(createChat.values.slice(1), [31, '测试 Chat']);
  assert.deepEqual(createCase.values.slice(1), [31, 41, '边界 Case']);
  assert.equal(calls.filter(call => call.sql.includes('state_events')).length, 2);
  assert.deepEqual(calls.find(call => call.sql.includes('FROM case_chats')).values, [31, chatId]);
});

test('a closed or foreign Chat cannot receive a Case', async () => {
  for (const chat of [undefined, { id: 41, status: 'FORCE_CLOSED' }]) {
    const { repository, calls } = fixture({ chat });
    await assert.rejects(repository.createCase(token, chatId, 'Case'),
      { code: chat ? 'CHAT_CLOSED' : 'CHAT_NOT_FOUND' });
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO cases')), false);
  }
});

test('case listing is limited to authenticated Workspace and requested Chat', async () => {
  const { repository, calls } = fixture({ chat: { id: 41, status: 'ACTIVE', title: 'Chat' }, cases: [{ title: 'Case' }] });
  assert.equal((await repository.listCases(token, chatId)).cases.length, 1);
  assert.deepEqual(calls.find(call => call.sql.includes('FROM cases')).values, [31, 41]);
  await assert.rejects(repository.listCases(token, 'not-a-uuid'), { code: 'INVALID_ID' });
  await repository.listCases(token, chatId.toUpperCase());
  assert.deepEqual(calls.filter(call => call.sql.includes('FROM case_chats')).at(-1).values, [31, chatId]);
});
