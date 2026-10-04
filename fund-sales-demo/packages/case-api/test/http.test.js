import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createCaseHttpServer } from '../src/http.js';

const route = '/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/discussion';
const planRoute = route.replace('/discussion', '/plan');
const allowedOrigin = 'http://127.0.0.1:3100';

async function fixture(t) {
  const calls = [];
  const server = createCaseHttpServer({
    allowedOrigin,
    repository: { readCaseDiscussion: async (...args) => {
      calls.push(['read', ...args]); return { revision: 2, turns: [], pending: null };
    }, getLatestSopProposal: async (...args) => {
      calls.push(['plan', ...args]); return { versionNumber: 1, status: 'PENDING_CONFIRMATION' };
    } },
    discussionService: { discuss: async args => {
      calls.push(['discuss', args]); return { reply: '请确认', revision: 3 };
    }, propose: async args => {
      calls.push(['propose', args]); return { reply: '测试目标：检查规则', versionNumber: 1 };
    } },
    confirmPlan: async args => {
      calls.push(['confirm', args]); return { phase: 'SOP_LOCKED', versionNumber: 1 };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { calls, base: `http://127.0.0.1:${server.address().port}` };
}

test('a scoped discussion reads and writes through the authenticated service', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const read = await fetch(base + route, { headers });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).revision, 2);
  const write = await fetch(base + route, { method: 'POST', headers,
    body: JSON.stringify({ userInput: '继续讨论' }) });
  assert.equal(write.status, 200);
  assert.equal((await write.json()).revision, 3);
  assert.equal(calls[0][1], 'abcdefghijklmnopqrstuvwxyz012345');
  assert.equal(calls[1][1].userInput, '继续讨论');
});

test('a Plan can be proposed, reviewed, and explicitly confirmed by version', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const proposed = await fetch(base + planRoute, { method: 'POST', headers,
    body: JSON.stringify({ userInput: '请生成 Plan' }) });
  assert.equal((await proposed.json()).versionNumber, 1);
  const read = await fetch(base + planRoute, { headers });
  assert.equal((await read.json()).status, 'PENDING_CONFIRMATION');
  const confirmed = await fetch(base + planRoute + '/confirm', { method: 'POST', headers,
    body: JSON.stringify({ versionNumber: 1 }) });
  assert.equal((await confirmed.json()).phase, 'SOP_LOCKED');
  assert.deepEqual(calls.map(call => call[0]), ['propose', 'plan', 'confirm']);
  assert.equal(calls[2][1].versionNumber, 1);
});

test('discussion rejects missing session, foreign origin, and extra input fields', async t => {
  const { base, calls } = await fixture(t);
  assert.equal((await fetch(base + route)).status, 401);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: 'https://evil.test',
    'content-type': 'application/json' };
  assert.equal((await fetch(base + route, { method: 'POST', headers,
    body: JSON.stringify({ userInput: 'x' }) })).status, 403);
  headers.origin = allowedOrigin;
  assert.equal((await fetch(base + route, { method: 'POST', headers,
    body: JSON.stringify({ userInput: 'x', workspaceId: 'other' }) })).status, 400);
  assert.equal(calls.length, 0);
});
