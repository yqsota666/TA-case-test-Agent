import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createCaseHttpServer } from '../src/http.js';

const route = '/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/discussion';
const planRoute = route.replace('/discussion', '/plan');
const dataRoute = route.replace('/discussion', '/data');
const allowedOrigin = 'http://127.0.0.1:3100';

async function fixture(t, {orderRejected=false}={}) {
  const calls = [];
  const server = createCaseHttpServer({
    allowedOrigin,
    exchangePlanSupplement:{confirm:async(token,input)=>{calls.push(['supplement',token,input]);return{versionNumber:2,status:'LOCKED',supplemented:true};}},
    returnConfirmation: Object.fromEntries(['read','delivery','apply','salesData','selectAccount'].map(method =>
      [method,async (token,input) => { calls.push(['confirmation-'+method,token,input]); return { ok:true }; }])),
    caseResult:{read:async(token,scope)=>{calls.push(['result-read',token,scope]);return {reviewId:null};},evaluate:async(token,scope)=>{calls.push(['result-evaluate',token,scope]);return {suggestion:{outcome:'REVIEW'}};},confirm:async(token,input)=>{calls.push(['result-confirm',token,input]);return {finalVerdict:'PASS'};}},
    taReceipts:{read:async(token,input)=>{calls.push(['receipts-read',token,input]);return {supportedTypes:['02','04','05']};},parse:async(token,input)=>{calls.push(['receipts-parse',token,input]);return {phase:'PARSED',businessApplied:false};}},
    holdingsReturn: {
      read: async (token,scope)=>{calls.push(['holdings-read',token,scope]);return {steps:[],parses:[]};},
      parse: async (token,input)=>{calls.push(['holdings-parse',token,input]);return {phase:'PARSED'};},
      apply: async (token,input)=>{calls.push(['holdings-apply',token,input]);return {businessApplied:true};},
    },
    returnParsing: {
      read: async (token, scope) => { calls.push(['parsing-read', token, scope]); return { steps: [] }; },
      parse: async (token, input) => { calls.push(['parsing-write', token, input]); return orderRejected?{phase:'ORDER_REJECTED',parseId:'81',orderError:{error:'ORDER_VIOLATION',message:'缺少send03，请补齐后重试'},result:{businessApplied:false}}:{phase:'PARSED'}; },
    },
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
    applicationPreparation: {
      read: async (token, ids) => { calls.push(['read-preparation', token, ids]); return { phase: 'NEEDS_INPUT', revision: 1 }; },
      prepare: async args => { calls.push(['prepare', args]); return { phase: 'WAITING_TA', revision: 2 }; },
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

test('application preparation uses the scoped session, validates input and checks origin', async t => {
  const { base, calls } = await fixture(t);
  const path = route.replace('/discussion', '/application-preparation');
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  const read = await fetch(base + path, { headers });
  assert.equal(read.status, 200); assert.equal((await read.json()).phase, 'NEEDS_INPUT');
  const prepared = await fetch(base + path, { method: 'POST', headers,
    body: JSON.stringify({ revision: 1, userInput: '  补充资料  ', channelId: '7' }) });
  assert.equal(prepared.status, 200); assert.equal(calls.at(-1)[1].userInput, '补充资料');
  const invalid = await fetch(base + path, { method: 'POST', headers,
    body: JSON.stringify({ workspaceId: '999', userInput: '修改' }) });
  assert.equal(invalid.status, 400);
  const foreign = await fetch(base + path, { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' },
    body: JSON.stringify({}) });
  assert.equal(foreign.status, 403);
  assert.equal(calls.filter(call => call[0] === 'prepare').length, 1);
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
    body: JSON.stringify({ versionNumber: 1,section:'EXPECTATIONS' }) });
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


test('02/04 have separate scoped parse-only routes and reject authorization/input bypasses', async t => {
  const { base, calls } = await fixture(t);
  const path = route.replace('/discussion', '/return-parsing');
  const headers = { cookie: 'case_session=abcdefghijklmnopqrstuvwxyz012345', origin: allowedOrigin,
    'content-type': 'application/json' };
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(base + path, { headers })).status, 200);
  for (const type of ['02', '04']) {
    const response = await fetch(base + path + '/' + type, { method: 'POST', headers,
      body: JSON.stringify({ batchPublicId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', files: [] }) });
    assert.equal(response.status, 200);
    const input = calls.at(-1)[2];
    assert.equal(input.expectedType, type);
    assert.equal(input.chatPublicId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    assert.equal(input.casePublicId, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  }
  const payload = { batchPublicId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', files: [] };
  for (const [url, req, status] of [
    [path + '/04', { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body: JSON.stringify(payload) }, 403],
    [path + '/04', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: JSON.stringify(payload) }, 415],
    [path + '/04', { method: 'POST', headers, body: JSON.stringify({ ...payload, workspaceId: '999' }) }, 400],
    [path + '/04', { method: 'POST', headers, body: 'null' }, 400],
    [path + '/04', { method: 'POST', headers, body: '{' }, 400],
    [path + '/04', { headers }, 404],
    [path + '/05', { method: 'POST', headers, body: JSON.stringify(payload) }, 404],
  ]) assert.equal((await fetch(base + url, req)).status, status);
  assert.equal(calls.length, 3);
});

test('formal sales queries and confirmation mutations require auth, origin and exact scoped input', async t => {
  const { base,calls } = await fixture(t);
  const path = route.replace('/discussion','/return-confirmation');
  const headers = { cookie:'case_session=abcdefghijklmnopqrstuvwxyz012345',origin:allowedOrigin,'content-type':'application/json' };
  assert.equal((await fetch(base+'/api/sales-data')).status,401);
  assert.equal((await fetch(base+'/api/sales-data',{ headers })).status,200);
  assert.equal((await fetch(base+path,{ headers })).status,200);
  assert.equal((await fetch(base+path+'/apply',{ method:'POST',headers:{ ...headers,origin:'https://foreign.invalid' },body:'{}' })).status,403);
  assert.equal((await fetch(base+path+'/apply',{ method:'POST',headers,body:JSON.stringify({ parseId:'1',recordIndexes:[0],workspaceId:'foreign' }) })).status,400);
  for (const [action,body] of [['delivery',{ batchPublicId:'cccccccc-cccc-cccc-cccc-cccccccccccc' }],
    ['apply',{ parseId:'1',recordIndexes:[0] }],['account',{ accountPublicId:'dddddddd-dddd-dddd-dddd-dddddddddddd' }]]) {
    assert.equal((await fetch(base+path+'/'+action,{ method:'POST',headers,body:JSON.stringify(body) })).status,200);
  }
  const applied = calls.find(call => call[0]==='confirmation-apply');
  assert.equal(applied[2].chatPublicId,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(applied[2].casePublicId,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  assert.deepEqual(applied[2].recordIndexes,[0]);
});

test('planned upload rejects order with 409 and explicit evidence id; step id is forwarded, extra scope is forbidden',async t=>{
 const {base,calls}=await fixture(t,{orderRejected:true});
 const path=route.replace('/discussion','/return-parsing/04');
 const headers={'content-type':'application/json',origin:allowedOrigin,cookie:'case_session='+ 'a'.repeat(43)};
 const payload={batchPublicId:'cccccccc-cccc-cccc-cccc-cccccccccccc',exchangeStepId:'receive04',files:[]};
 const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(payload)});
 assert.equal(response.status,409);const body=await response.json();assert.equal(body.error,'ORDER_VIOLATION');assert.equal(body.parseId,'81');assert.match(body.message,/send03/);
 assert.equal(calls.at(-1)[2].exchangeStepId,'receive04');
 const wrong=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({...payload,workspaceId:'999'})});assert.equal(wrong.status,400);
});

test('legacy schedule supplement is explicit, authenticated and accepts only timing plus file mappings',async t=>{
 const {base,calls}=await fixture(t);const path=route.replace('/discussion','/exchange-plan/confirm');
 const headers={cookie:'case_session='+ 'a'.repeat(43),origin:allowedOrigin,'content-type':'application/json'};
 const payload={baseVersionNumber:1,exchangePlan:{status:'READY'},mappings:[]};
 const success=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(success.status,200);assert.equal((await success.json()).versionNumber,2);assert.equal(calls.at(-1)[0],'supplement');
 for(const extra of [{objective:'改目标'},{workspaceId:'999'}])assert.equal((await fetch(base+path,{method:'POST',headers,body:JSON.stringify({...payload,...extra})})).status,400);
 assert.equal((await fetch(base+path,{method:'POST',headers:{...headers,origin:'https://foreign.invalid'},body:JSON.stringify(payload)})).status,403);
});

 test('05 endpoints require session/origin, pass scoped ids and reject extra fields',async t=>{
  const {base,calls}=await fixture(t);const path=route.replace('/discussion','/holdings-return');
  const headers={cookie:'case_session=abcdefghijklmnopqrstuvwxyz012345',origin:allowedOrigin,'content-type':'application/json'};
  assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+path,{headers})).status,200);
  for(const [action,body] of [['parse',{channelId:'7',files:[],exchangeStepId:'r05'}],['apply',{parseId:'1'}]]){
   const result=await fetch(base+path+'/'+action,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(result.status,200);
   assert.equal(calls.at(-1)[0],'holdings-'+action);assert.equal(calls.at(-1)[2].casePublicId,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
   assert.equal((await fetch(base+path+'/'+action,{method:'POST',headers:{...headers,origin:'https://foreign.example'},body:JSON.stringify(body)})).status,403);
   assert.equal((await fetch(base+path+'/'+action,{method:'POST',headers,body:JSON.stringify({...body,workspaceId:'999'})})).status,400);
  }
 });

test('result-review endpoints require authentication, origin and exact bodies',async t=>{
 const {base,calls}=await fixture(t);const path=route.replace('/discussion','/result-review');
 const headers={cookie:'case_session=abcdefghijklmnopqrstuvwxyz012345',origin:allowedOrigin,'content-type':'application/json'};
 assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{headers})).status,200);
 for(const [action,body] of [['evaluate',{}],['confirm',{reviewId:'1',verdict:'PASS',reason:'人工核对'}]]){
  assert.equal((await fetch(base+path+'/'+action,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.equal(calls.at(-1)[0],'result-'+action);
  assert.equal((await fetch(base+path+'/'+action,{method:'POST',headers:{...headers,origin:'https://foreign.example'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(base+path+'/'+action,{method:'POST',headers,body:JSON.stringify({...body,workspaceId:'99'})})).status,400);
 }
});

test('Plan confirmation requires an explicit data or expectation section and rejects legacy one-click payloads',async t=>{
 const {base,calls}=await fixture(t);
 const headers={cookie:'case_session=abcdefghijklmnopqrstuvwxyz012345',origin:allowedOrigin,'content-type':'application/json'};
 for(const body of [{versionNumber:1},{versionNumber:1,section:'ALL'},{versionNumber:1,section:'DATA',confirmed:true}]){
  const r=await fetch(base+planRoute+'/confirm',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,400);
 }
 assert.equal(calls.length,0);
 const r=await fetch(base+planRoute+'/confirm',{method:'POST',headers,body:JSON.stringify({versionNumber:1,section:'DATA'})});assert.equal(r.status,200);assert.equal(calls[0][1].section,'DATA');
});

 test('unified receipt routes keep scoped authentication, exact JSON and origin requirements',async t=>{
 const {base,calls}=await fixture(t);const path=route.replace('/discussion','/ta-receipts');
 const headers={cookie:'case_session=abcdefghijklmnopqrstuvwxyz012345',origin:allowedOrigin,'content-type':'application/json'};
 assert.equal((await fetch(base+path)).status,401);
 assert.equal((await fetch(base+path,{headers})).status,200);
 const body={channelId:'2',files:[],routes:[{fileType:'04',batchPublicId:'cccccccc-cccc-cccc-cccc-cccccccccccc'}]};
 assert.equal((await fetch(base+path+'/parse',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
 assert.equal(calls.at(-1)[0],'receipts-parse');assert.equal(calls.at(-1)[2].casePublicId,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
 assert.equal((await fetch(base+path+'/parse',{method:'POST',headers,body:JSON.stringify({...body,workspaceId:'other'})})).status,400);
 assert.equal((await fetch(base+path+'/parse',{method:'POST',headers:{...headers,origin:'http://evil.invalid'},body:JSON.stringify(body)})).status,403);
 });

test('strict Plan cannot bypass frozen application values through the legacy manual record endpoint',async t=>{
 let staged=0;
 const server=createCaseHttpServer({repository:{generatedData:async()=>({reviewStatus:'CONFIRMED',planDataFrozen:true,planVersionId:'1'})},discussionService:{},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{},exchangeRepository:{stageApplication:async()=>{staged++;return{};}},allowedOrigin:'http://127.0.0.1:5188'});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/applications`;
 const response=await fetch(url,{method:'POST',headers:{origin:'http://127.0.0.1:5188',cookie:'case_session=synthetic','content-type':'application/json'},body:JSON.stringify({channelId:'1',businessDate:'20261006',fileType:'03',record:{ApplicationAmount:'450.00'}})});
 assert.equal(response.status,409);assert.equal((await response.json()).error,'PLAN_DATA_FROZEN');assert.equal(staged,0);
});
