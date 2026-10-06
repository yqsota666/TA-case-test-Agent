import { exchangePlan } from '../../case-agent/test/exchange-plan-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createReturnParsingRepository } from '../src/return-parsing.js';
import { createReturnParsingService } from '../../case-api/src/return-parsing.js';
import { buildDataFile, parseReturnFiles } from '../../platform-protocol/src/index.js';
const scope = { chatPublicId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', casePublicId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
const batchPublicId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const token = 'a'.repeat(43);
const input = type => ({ ...scope, batchPublicId, expectedType: type, files: [{ fileName: `OFD_27_306_20261007_${type}_001.TXT`,
  base64: buildDataFile({ creator: '27', receiver: '306', date: '20261007', fileType: type, records: [{ ReturnCode: '0000' }] }).toString('base64') }] });
function fixture({ owner = { chat_id: 41, case_id: 51, chat_status: 'ACTIVE', case_status: 'EXECUTING' },
  rows, prior, history = [], failFile = false, sent = true, legacy = false } = {}) {
  const calls = [];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if(sql.includes('FROM case_sop_versions')) return [[{version_number:1,plan_json:legacy?{}:{exchangePlan}}]];
    if(sql.includes('FROM case_exchange_plan_receipts'))return [[]];
    if(sql.includes('FROM case_exchange_plan_bindings'))return [prior?[{stepId:'receive04',batch_id:61,file_type:'04'}]:[]];
    if(sql.includes('INSERT INTO case_exchange_plan_bindings') || sql.includes('INSERT INTO case_exchange_plan_receipts'))return [{affectedRows:1}];
    if(sql.includes('FROM case_exchange_plan_events')) return [[...(sent?[{stepId:'send03',condition:'SENT',batch_id:61}]:[]),...(prior?[{stepId:'receive04',condition:'PARSED',batch_id:61,parse_id:81}]:[])]];
    if(sql.includes('INSERT INTO case_exchange_plan_events')) return [{affectedRows:1}];
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_chats c')) return [[owner]];
    if (sql.includes('SELECT DISTINCT')) return [rows ?? [{ batch_id: 61, batch_public_id: batchPublicId,
      file_type: '03', file_name: 'OFD_306_27_20261006_03_001.TXT', ta_code: '27', distributor_code: '306', protocol_version: '22' }]];
    if (sql.includes('FROM case_return_parses')) return [sql.includes('content_sha256=?') ? [prior].filter(Boolean) : history];
    if (sql.includes('INSERT INTO case_return_parses')) return [{ insertId: 81 }];
    if (sql.includes('INSERT INTO case_return_parse_files')) {
      if (failFile) throw Object.assign(new Error('storage failure'), { code: 'ER_STORAGE_FAILURE' });
      return [{ affectedRows: 1 }];
    }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  let transactionOpen = false;
  const repo = createReturnParsingRepository({ transaction: async action => {
    transactionOpen = true;
    try { return await action(db); } finally { transactionOpen = false; }
  } });
  return { calls, repo, isTransactionOpen: () => transactionOpen, service: createReturnParsingService({ repository: repo }) };
}

test('direct03 creates only a wait04 path; a different Case cannot read the target', async () => {
  const f = fixture();
  const result = await f.service.read(token, scope);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].expectedType, '04');
  assert.equal(result.steps[0].phase, 'WAITING_UPLOAD');
  assert.deepEqual(f.calls.find(c => c.sql.includes('SELECT DISTINCT')).values, [31, 41, 51]);
  await assert.rejects(fixture({ owner: undefined, rows: [] }).service.parse(token, input('04')), { code: 'RETURN_NOT_EXPECTED' });
  await assert.rejects(fixture({ owner: null }).service.read(token, scope), { code: 'CASE_NOT_FOUND' });
});

test('parsing stores raw bytes and complete result but never modifies applications, bindings, Case or batch', async () => {
  const f = fixture();
  const result = await f.service.parse(token, input('04'));
  assert.equal(result.phase, 'PARSED'); assert.equal(result.duplicate, false);
  assert.equal(result.result.businessApplied, false);
  assert.equal(result.result.applicationsMatched, false);
  const writes = f.calls.filter(c => /^INSERT|^UPDATE/.test(c.sql));
  assert.equal(writes.length, 4);
  assert.ok(writes.every(c => /^INSERT INTO (case_return_parse|case_exchange_plan_events|case_exchange_plan_bindings|case_exchange_plan_receipts)/.test(c.sql)));
  assert.deepEqual(writes[0].values.slice(0, 5), [31, 41, 51, '61', '04']);
  assert.equal(writes[0].values.at(-1), 7);
  assert.deepEqual(writes[1].values.at(-1), Buffer.from(input('04').files[0].base64, 'base64'));
  assert.match(f.calls.filter(c => c.sql.includes('FROM case_chats c')).at(-1).sql, /FOR UPDATE/);
});

test('CPU parsing holds no transaction; a Case closed during parsing cannot persist the result', async () => {
  const owner = { chat_id: 41, case_id: 51, chat_status: 'ACTIVE', case_status: 'EXECUTING' };
  const f = fixture({ owner });
  const request = input('04');
  await assert.rejects(f.repo.parse(token, request, async target => {
    assert.equal(f.isTransactionOpen(), false);
    const parsed = parseReturnFiles(request.files, { expectedType: '04', channel: target.channel });
    owner.chat_status = 'CLOSED';
    return { parsed, phase: 'PARSED' };
  }), { code: 'CASE_NOT_WRITABLE' });
  assert.ok(!f.calls.some(call => call.sql.startsWith('INSERT')));
});

test('replay deduplicates only the scoped parse; read restores persisted results after service recreation', async () => {
  const first = await fixture().service.parse(token, input('04'));
  const f = fixture({ prior: { id: 81, parsed_json: JSON.stringify(first.result) },
    history: [{ id: 81, batch_id: 61, expected_type: '04', parsed_json: first.result }] });
  const replay = await f.service.parse(token, input('04'));
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.result, first.result);
  assert.ok(!f.calls.some(c => c.sql.startsWith('INSERT')));
  const restored = await createReturnParsingService({ repository: f.repo }).read(token, scope);
  assert.equal(restored.steps[0].phase, 'PARSED');
  assert.deepEqual(restored.steps[0].parses[0].result, first.result);
});

test('wrong type, ungenerated path, ended Case and corrupt uploads do not write', async () => {
  for (const [f, request, code] of [
    [fixture(), input('02'), 'RETURN_NOT_EXPECTED'],
    [fixture({ rows: [] }), input('04'), 'RETURN_NOT_EXPECTED'],
    [fixture({ owner: { chat_id: 41, case_id: 51, chat_status: 'CLOSED', case_status: 'EXECUTING' } }), input('04'), 'CASE_NOT_WRITABLE'],
    [fixture({ owner: { chat_id: 41, case_id: 51, chat_status: 'ACTIVE', case_status: 'PASS' } }), input('04'), 'CASE_NOT_WRITABLE'],
    [fixture(), { ...input('04'), files: input('02').files }, 'RETURN_TYPE_MISMATCH'],
  ]) {
    await assert.rejects(f.service.parse(token, request), { code });
    assert.ok(!f.calls.some(c => c.sql.startsWith('INSERT')));
  }
});

test('storage failure propagates to the outer transaction rather than claiming parse success', async () => {
  await assert.rejects(fixture({ failFile: true }).service.parse(token, input('04')), { code: 'ER_STORAGE_FAILURE' });
});

 test('out of order parse retains original bytes without accepting step; explicit retry accepts same package',async()=>{
 const blocked=fixture({sent:false});
 const result=await blocked.service.parse(token,{...input('04'),exchangeStepId:'receive04'});
 assert.equal(result.phase,'ORDER_REJECTED');assert.ok(['ORDER_VIOLATION','EXCHANGE_BATCH_MISMATCH'].includes(result.orderError.error));
 assert.equal(blocked.calls.filter(c=>c.sql.startsWith('INSERT INTO case_return_parse')).length,2);
 assert.ok(!blocked.calls.some(c=>c.sql.startsWith('INSERT INTO case_exchange_plan_events')));
 const retry=fixture({prior:{id:81,parsed_json:result.result}});
 const accepted=await retry.service.parse(token,input('04'));
 assert.equal(accepted.phase,'PARSED');assert.equal(accepted.duplicate,true);
 assert.ok(!retry.calls.some(c=>c.sql.startsWith('INSERT INTO case_return_parse')));
 });
 test('legacy Plan is explicitly unplanned, preserves historical parsed evidence but no completion',async()=>{
 const legacy=fixture({legacy:true});
 const result=await legacy.service.parse(token,input('04'));
 assert.equal(result.phase,'ORDER_REJECTED');assert.equal(result.orderError.error,'EXCHANGE_PLAN_REQUIRED');
 const restored=await legacy.service.read(token,scope);assert.equal(restored.exchangePlanStatus,'UNPLANNED');
 });
