import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWritableRun } from '../services/sales/src/platform/scope.js';

test('a standalone run write is rejected with an HTTP 409 while a global Chat is active', async () => {
  const db = { execute: async sql => {
    if (sql.includes('COALESCE')) return [[{ parent_chat_id: null }]];
    if (sql.includes('FOR UPDATE')) return [[{ id: 1 }]];
    if (sql.includes('ended_at IS NULL')) return [[{ chat_id: 9 }]];
    throw new Error('Unexpected query');
  } };
  await assert.rejects(assertWritableRun(db, { workspace_id: 1 }, { chat_id: 2, run_id: 3 }),
    { status: 409, code: 'CHAT_SCOPE_REQUIRED' });
});
