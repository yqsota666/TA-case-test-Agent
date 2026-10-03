import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { buildDataFile } from '../../platform-protocol/src/index.js';
import { createExchangeRepository } from '../src/exchange.js';

const token = 'a'.repeat(43);
const chatPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const casePublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccd';
const applicationPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837cce';
const record = { AppSheetSerialNo: '202610030001', BusinessCode: '001', DistributorCode: '306' };
const raw = buildDataFile({ creator: '27', receiver: '306', date: '20261003', fileType: '02', records: [record] });

function fixture({ existing, returnItem, application, batchApplications, pendingCount = 0 } = {}) {
  const calls = [];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('SELECT id,status FROM case_chats')) return [[{ id: 41, status: 'ACTIVE' }]];
    if (sql.includes('FROM case_chats')) return [[{
      chat_id: 41, case_id: 51, sop_id: 61, channel_id: 71, distributor_code: '306', protocol_version: '22'
    }]];
    if (sql.includes('COUNT(*) AS count FROM cases')) return [[{ count: pendingCount }]];
    if (sql.includes('FROM applications') && sql.includes('public_id IN')) return [batchApplications ?? []];
    if (sql.includes('MAX(batch_number)')) return [[{ number: 0 }]];
    if (sql.includes('FROM exchange_channels')) return [[{
      id: 71, ta_code: '27', distributor_code: '306', protocol_version: '22'
    }]];
    if (sql.includes('FROM exchange_files')) return [[existing]];
    if (sql.includes('FROM return_records')) return [[returnItem]];
    if (sql.includes('FROM applications')) return [[application]];
    if (sql.includes('INSERT INTO exchange_files')) return [{ insertId: 81 }];
    if (sql.includes('INSERT INTO exchange_batches')) return [{ insertId: 111 }];
    return [{ insertId: 91 }];
  } };
  return { calls, repository: createExchangeRepository({ transaction: action => action(db) }) };
}

test('stages an encoded 01 snapshot under a locked SOP and server-side scope', async () => {
  const { repository, calls } = fixture();
  const result = await repository.stageApplication(token, {
    chatPublicId, casePublicId, sopVersionId: '61', channelId: '71', businessDate: '20261003',
    fileType: '01', record
  });
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
  const scope = calls.find(call => call.sql.includes('FROM case_chats'));
  assert.match(scope.sql, /s\.status='LOCKED'/);
  assert.deepEqual(scope.values, [31, chatPublicId, casePublicId, '61', '71']);
  const saved = calls.find(call => call.sql.includes('INSERT INTO applications'));
  assert.deepEqual(saved.values.slice(1, 6), [31, 41, 51, 61, 71]);
});

test('an incoming file is checked against its channel and kept whole before matching', async () => {
  const { repository, calls } = fixture();
  const result = await repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_27_306_20261003_02.TXT', rawBytes: raw
  });
  assert.deepEqual(result, { fileId: '81', duplicate: false, businessDate: '2026-10-03', recordCount: 1 });
  const saved = calls.find(call => call.sql.includes('INSERT INTO exchange_files'));
  assert.equal(saved.values[0], 31);
  assert.equal(saved.values[4].length, 64);
  assert.equal(Buffer.compare(saved.values[5], raw), 0);
  const row = calls.find(call => call.sql.includes('INSERT INTO return_records'));
  assert.deepEqual(row.values.slice(0, 5), [31, '71', 81, '02', 1]);
  assert.equal(JSON.parse(row.values[5]).AppSheetSerialNo, record.AppSheetSerialNo);
});

test('a duplicate file with identical bytes does not duplicate records', async () => {
  const { repository } = fixture({ existing: {
    id: 81, content_sha256: 'placeholder'
  } });
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  const copy = fixture({ existing: { id: 81, content_sha256: digest } });
  assert.deepEqual(await copy.repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_27_306_20261003_02.TXT', rawBytes: raw
  }), { fileId: '81', duplicate: true });
  assert.equal(copy.calls.some(call => call.sql.includes('INSERT INTO return_records')), false);
  await assert.rejects(repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_27_306_20261003_02.TXT', rawBytes: raw
  }), { code: 'FILE_NAME_CONFLICT' });
});

test('foreign headers are rejected before storing any file bytes', async () => {
  const { repository, calls } = fixture();
  await assert.rejects(repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_99_306_20261003_02.TXT', rawBytes: raw
  }), { code: 'FILE_CHANNEL_MISMATCH' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO exchange_files')), false);
});

test('matching uses the application number, business code, type and delivery state', async () => {
  const returnItem = { id: 91, channel_id: 71, file_type: '02', record_json: record, match_status: 'UNMATCHED' };
  const application = { id: 101, chat_id: 41, case_id: 51, app_no: record.AppSheetSerialNo,
    business_code: '001', file_type: '01', status: 'DELIVERED' };
  const { repository, calls } = fixture({ returnItem, application });
  assert.deepEqual(await repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }), { matched: true });
  assert.deepEqual(calls.find(call => call.sql.includes('UPDATE return_records')).values,
    [41, 51, 101, 31, 91]);
  const wrong = fixture({ returnItem, application: { ...application, status: 'READY' } });
  await assert.rejects(wrong.repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }),
    { code: 'RETURN_MISMATCH' });
});

test('a batch groups ready applications only after all Chat Case SOPs are locked', async () => {
  const batchApplications = [{ id: 101, public_id: applicationPublicId, status: 'READY',
    business_date: '2026-10-03', channel_id: 71, file_type: '01' }];
  const { repository, calls } = fixture({ batchApplications });
  const result = await repository.createOutboundBatch(token, {
    chatPublicId, channelId: '71', businessDate: '20261003', applicationPublicIds: [applicationPublicId]
  });
  assert.equal(result.batchNumber, 1);
  assert.deepEqual(calls.find(call => call.sql.includes('INSERT INTO batch_applications')).values,
    [31, 41, '71', 111, 101, '01']);
  const pending = fixture({ batchApplications, pendingCount: 1 });
  await assert.rejects(pending.repository.createOutboundBatch(token, {
    chatPublicId, channelId: '71', businessDate: '20261003', applicationPublicIds: [applicationPublicId]
  }), { code: 'SOP_NOT_LOCKED' });
  assert.equal(pending.calls.some(call => call.sql.includes('INSERT INTO exchange_batches')), false);
});
