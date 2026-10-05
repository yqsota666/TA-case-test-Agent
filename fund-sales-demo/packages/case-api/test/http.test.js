import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createCaseHttpServer } from '../src/http.js';

const route = '/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/discussion';
const planRoute = route.replace('/discussion', '/plan');
const dataRoute = route.replace('/discussion', '/data');
const allowedOrigin = 'http://127.0.0.1:3100';

async function fixture(t) {
  const calls = [];
  const server = createCaseHttpServer({
    allowedOrigin,
    repository: { readCaseDiscussion: async (...args) => {
      calls.push(['read', ...args]); return { revision: 2, turns: [], pending: null };
    }, generatedData: async (...args) => {
      calls.push(['data', ...args]); return { status: 'NOT_STARTED', customers: [], accounts: [], funds: [] };
    }, editGeneratedData: async (...args) => {
      calls.push(['edit-data', ...args]); return { status: 'VALIDATED', revision: 1 };
    }, generatedDataCatalog: async (...args) => {
      calls.push(['catalog', ...args]); return { items: [] };
    }, dataReviewTurns: async (...args) => {
      calls.push(['review-turns', ...args]); return { turns: [] };
    }, confirmGeneratedData: async (...args) => {
      calls.push(['confirm-data', ...args]); return { status: 'VALIDATED', reviewStatus: 'CONFIRMED' };
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
    executeData: async args => {
      calls.push(['execute-data', args]); return { status: 'VALIDATED', customers: [] };
    },
    reviseData: async args => {
      calls.push(['revise-data', args]); return { reply: '已修改', data: { revision: 1 } };
    },
    exchangeRepository: {
      listChannels: async token => { calls.push(['channels', token]); return { channels: [] }; },
      listCaseApplications: async (token, ids) => {
        calls.push(['applications', token, ids]); return { applications: [] };
      },
      stageApplication: async (token, input) => {
        calls.push(['stage', token, input]); return { publicId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' };
      },
      createOutboundBatch: async (token, input) => {
        calls.push(['batch', token, input]); return { publicId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
      },
      generateOutboundFiles: async (token, input) => {
        calls.push(['generate', token, input]); return { files: [] };
      },
      listOutboundFiles: async token => { calls.push(['files', token]); return { files: [] }; },
      readOutboundFile: async token => { calls.push(['read-file', token]); return {
        fileName: 'OFD_306_27_20261003_01_001.TXT', rawBytes: Buffer.from([0, 1, 2]), sha256: 'a'.repeat(64),
      }; },
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

test('table edits require a valid scoped payload and same-origin request', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const edit = { revision: 0, changes: { customers: [], accounts: [], funds: [], holdings: [
    { id: null, accountId: '2', fundCode: '990901', shareClass: 'A', totalVolume: '1200.00000000' },
  ] } };
  assert.equal((await fetch(base + dataRoute, { method: 'PATCH', headers,
    body: JSON.stringify(edit) })).status, 200);
  assert.equal(calls.at(-1)[0], 'edit-data');
  assert.deepEqual(calls.at(-1)[4], edit);
  assert.equal((await fetch(base + dataRoute, { method: 'PATCH', headers,
    body: JSON.stringify({ ...edit, workspaceId: 1 }) })).status, 422);
  assert.equal((await fetch(base + dataRoute, { method: 'PATCH',
    headers: { ...headers, origin: 'https://wrong.example' }, body: JSON.stringify(edit) })).status, 403);
  assert.equal(calls.length, 1);
});

test('the read-only data catalog uses the session scope', async t => {
  const { base, calls } = await fixture(t);
  assert.equal((await fetch(base + '/api/data/catalog')).status, 401);
  const response = await fetch(base + '/api/data/catalog', {
    headers: { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.deepEqual(calls, [['catalog', 'abcdefghijklmnopqrstuvwxyz012345']]);
});

test('file downloads retain original bytes and writes require the same origin', async t => {
  const { base, calls } = await fixture(t);
  const chat = '/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const cookie = 'case_session=abcdefghijklmnopqrstuvwxyz012345';
  const file = await fetch(`${base}${chat}/files/81`, { headers: { cookie } });
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([0, 1, 2]));
  assert.match(file.headers.get('content-disposition'), /OFD_306_27/);
  assert.equal((await fetch(`${base}${chat}/files/81`)).status, 401);
  const denied = await fetch(`${base}${chat}/batches`, { method: 'POST', headers: {
    cookie, origin: 'https://foreign.example', 'content-type': 'application/json',
  }, body: JSON.stringify({ channelId: '71', businessDate: '20261003', applicationPublicIds: [] }) });
  assert.equal(denied.status, 403);
  assert.deepEqual(calls.map(call => call[0]), ['read-file']);
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

test('data execution remains scoped and validates its input', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const before = await fetch(base + dataRoute, { headers });
  assert.equal((await before.json()).status, 'NOT_STARTED');
  assert.deepEqual(calls.map(call => call[0]), ['data']);
  const created = await fetch(base + dataRoute + '/execute', { method: 'POST', headers,
    body: JSON.stringify({ versionNumber: 1 }) });
  assert.equal((await created.json()).status, 'VALIDATED');
  assert.equal(calls[1][0], 'execute-data');
  assert.equal(calls[1][1].versionNumber, 1);
  const invalid = await fetch(base + dataRoute + '/execute', { method: 'POST', headers,
    body: JSON.stringify({ versionNumber: 1, customerName: '伪造' }) });
  assert.equal(invalid.status, 400);
  const wrongMethod = await fetch(base + dataRoute, { method: 'POST', headers,
    body: JSON.stringify({ userInput: '绕过数据执行' }) });
  assert.equal(wrongMethod.status, 404);
  assert.equal(calls.length, 2);
});

test('data review turns, AI revisions, and explicit confirmation are scoped', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const turns = await fetch(base + dataRoute + '/review', { headers });
  assert.deepEqual(await turns.json(), { turns: [] });
  const revision = await fetch(base + dataRoute + '/review', { method: 'POST', headers,
    body: JSON.stringify({ revision: 2, userInput: '把客户余额改为 120000 元' }) });
  assert.equal(revision.status, 200);
  assert.equal((await revision.json()).data.revision, 1);
  assert.equal(calls.at(-1)[1].revision, 2);
  assert.equal((await fetch(base + dataRoute + '/review', { method: 'POST', headers,
    body: JSON.stringify({ revision: 2, userInput: '修改', workspaceId: 'foreign' }) })).status, 400);
  const confirmed = await fetch(base + dataRoute + '/confirm', { method: 'POST', headers,
    body: JSON.stringify({ revision: 3 }) });
  assert.equal((await confirmed.json()).reviewStatus, 'CONFIRMED');
  assert.deepEqual(calls.at(-1), ['confirm-data', 'abcdefghijklmnopqrstuvwxyz012345',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3]);
});

test('review input survives split UTF-8 chunks and larger table edits fit the request limit', async t => {
  const { base, calls } = await fixture(t);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const body = Buffer.from(JSON.stringify({ revision: 0, userInput: '修改客户余额' }));
  const split = body.indexOf(Buffer.from('客')) + 1;
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(base + dataRoute + '/review', { method: 'POST', headers }, reply => {
      reply.resume(); reply.on('end', () => resolve(reply));
    });
    request.on('error', reject);
    request.write(body.subarray(0, split));
    setImmediate(() => request.end(body.subarray(split)));
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.at(-1)[1].userInput, '修改客户余额');

  const manyCustomers = Array.from({ length: 50 }, (_, index) => ({ id: null,
    name: `模拟客户${index}${'甲'.repeat(100)}`, investorType: '1', simulatedBalance: '100.00',
    branchCode: '305' }));
  const edit = { revision: 0, changes: { customers: manyCustomers,
    accounts: [], funds: [], holdings: [] } };
  assert.ok(Buffer.byteLength(JSON.stringify(edit)) > 5000);
  const large = await fetch(base + dataRoute, { method: 'PATCH', headers,
    body: JSON.stringify(edit) });
  assert.equal(large.status, 200);
  assert.equal(calls.at(-1)[4].changes.customers.length, 50);
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

test('discussion rejects malformed cookies and invalid message lengths', async t => {
  const { base, calls } = await fixture(t);
  assert.equal((await fetch(base + route, { headers: { cookie: 'case_session=%ZZ' } })).status, 401);
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  for (const userInput of ['  ', 'x'.repeat(4001)]) {
    const response = await fetch(base + route, { method: 'POST', headers,
      body: JSON.stringify({ userInput }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
});
