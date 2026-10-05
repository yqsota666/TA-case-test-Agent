import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { buildDataFile, parseDataFile } from '../../platform-protocol/src/index.js';
import { createExchangeRepository } from '../src/exchange.js';

const token = 'a'.repeat(43);
const chatPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const casePublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccd';
const applicationPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837cce';
const record = { AppSheetSerialNo: '202610030001', BusinessCode: '001', DistributorCode: '306',
  CertificateType: '0', CertificateNo: 'TEST123', InvestorName: 'Alice', TransactionDate: '20261003',
  TransactionTime: '120000', IndividualOrInstitution: '0', TransactionAccountID: '123456', BranchCode: '306' };
const returned = { ...record, BusinessCode: '101', ReturnCode: '0000', TAAccountID: 'TA123' };
const raw = buildDataFile({ creator: '27', receiver: '306', date: '20261003', fileType: '02', records: [returned] });

function fixture({ existing, sameBytes, returnItem, application, batchApplications, priorMembers, binding,
  pendingCount = 0, missingReviewCount = 0, sourceAccount = {
    id: 1, branch_code: '306', name: 'Alice', investor_type: '0'
  }, sourceFund = { id: 1 }, generatedBatch, generatedApps, generatedFiles = [] } = {}) {
  const calls = [];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_generated_accounts a')) return [[sourceAccount]];
    if (sql.includes('FROM case_generated_funds')) return [[sourceFund]];
    if (sql.includes('FROM exchange_batches b JOIN batch_applications ba')) return [priorMembers ?? []];
    if (sql.includes('FROM exchange_batches b')) return [[generatedBatch ?? {
      id: 111, status: 'DRAFT', channel_id: 71, business_date: '20261003',
      ta_code: '27', distributor_code: '306', protocol_version: '22'
    }]];
    if (sql.includes('FROM batch_applications ba')) return [generatedApps ?? []];
    if (sql.includes('FROM exchange_files') && sql.includes('file_name FROM')) return [generatedFiles];
    if (sql.includes('FROM exchange_files') && sql.includes('SELECT id,file_name,file_type')) return [generatedFiles];
    if (sql.includes('SELECT id,status FROM case_chats')) return [[{ id: 41, status: 'ACTIVE' }]];
    if (sql.includes('FROM case_chats')) return [[{
      chat_id: 41, case_id: 51, sop_id: 61, channel_id: 71, distributor_code: '306', protocol_version: '22'
    }]];
    if (sql.includes('LEFT JOIN case_data_confirmations d')) {
      return [[{ count: missingReviewCount }]];
    }
    if (sql.includes('COUNT(*) AS count FROM cases')) return [[{ count: pendingCount }]];
    if (sql.includes('FROM applications') && sql.includes('public_id IN')) {
      return [typeof batchApplications === 'function' ? batchApplications(sql) : batchApplications ?? []];
    }
    if (sql.includes('MAX(batch_number)')) return [[{ number: 0 }]];
    if (sql.includes('FROM exchange_channels')) return [[{
      id: 71, ta_code: '27', distributor_code: '306', protocol_version: '22'
    }]];
    if (sql.includes('FROM exchange_files')) return [[sql.includes('content_sha256=?') ? sameBytes : existing]];
    if (sql.includes('FROM ta_account_bindings')) return [[binding]];
    if (sql.includes('FROM return_records')) return [[returnItem]];
    if (sql.includes('FROM applications')) return [[application]];
    if (sql.includes('INSERT INTO exchange_files')) return [{ insertId: 81 }];
    if (sql.includes('INSERT INTO exchange_batches')) return [{ insertId: 111 }];
    if (sql.includes('UPDATE applications')) return [{ affectedRows: 1 }];
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
  assert.match(scope.sql, /AND EXISTS \(SELECT 1 FROM case_data_confirmations d/);
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
  assert.equal(JSON.parse(row.values[5]).AppSheetSerialNo, returned.AppSheetSerialNo);
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
  const otherName = fixture({ sameBytes: { id: 81 } });
  assert.deepEqual(await otherName.repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_27_306_20261003_02_001.TXT', rawBytes: raw
  }), { fileId: '81', duplicate: true });
  assert.equal(otherName.calls.some(call => call.sql.includes('INSERT INTO return_records')), false);
});

test('foreign headers are rejected before storing any file bytes', async () => {
  const { repository, calls } = fixture();
  await assert.rejects(repository.saveInboundFile(token, {
    channelId: '71', fileName: 'OFD_99_306_20261003_02.TXT', rawBytes: raw
  }), { code: 'FILE_CHANNEL_MISMATCH' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO exchange_files')), false);
});

test('matching uses the application number, mapped code, key fields and delivery state', async () => {
  const returnItem = { id: 91, channel_id: 71, file_type: '02', record_json: returned, match_status: 'UNMATCHED' };
  const application = { id: 101, chat_id: 41, case_id: 51, app_no: record.AppSheetSerialNo,
    business_code: '001', file_type: '01', record_json: record, status: 'DELIVERED' };
  const { repository, calls } = fixture({ returnItem, application });
  assert.deepEqual(await repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }), { matched: true });
  assert.deepEqual(calls.find(call => call.sql.includes('UPDATE return_records')).values,
    [41, 51, 101, 31, 91]);
  assert.deepEqual(calls.find(call => call.sql.includes('INSERT INTO ta_account_bindings')).values,
    [31, 71, '123456', 'TA123', 91]);
  const wrong = fixture({ returnItem, application: { ...application, status: 'READY' } });
  await assert.rejects(wrong.repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }),
    { code: 'RETURN_MISMATCH' });
  const foreign = fixture({ returnItem: { ...returnItem, record_json: { ...returned, DistributorCode: '999' } }, application });
  await assert.rejects(foreign.repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }),
    { code: 'RETURN_MISMATCH' });
});

test('02 matching rejects a changed TA account for an existing account application', async () => {
  const source = { ...record, BusinessCode: '002', TAAccountID: 'TA123' };
  const application = { id: 101, chat_id: 41, case_id: 51, app_no: source.AppSheetSerialNo,
    business_code: '002', file_type: '01', record_json: source, status: 'DELIVERED' };
  const returnItem = { id: 91, channel_id: 71, file_type: '02', match_status: 'UNMATCHED',
    record_json: { ...returned, BusinessCode: '102', TAAccountID: 'TA999' } };
  const { repository, calls } = fixture({ returnItem, application });
  await assert.rejects(repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }),
    { code: 'RETURN_MISMATCH' });
  assert.equal(calls.some(call => call.sql.includes('UPDATE return_records')), false);
});

test('03 staging requires a TA account confirmed by a matched successful 02', async () => {
  const trade = { AppSheetSerialNo: '202610030022', BusinessCode: '022', DistributorCode: '306',
    TransactionDate: '20261003', TransactionTime: '120000', TransactionAccountID: '123456',
    TAAccountID: 'TA123', BranchCode: '306', FundCode: '000001', CurrencyType: '156',
    ApplicationAmount: '100.00', ShareClass: 'A', ChargeType: '0' };
  const input = { chatPublicId, casePublicId, sopVersionId: '61', channelId: '71',
    businessDate: '20261003', fileType: '03', record: trade };
  const missing = fixture();
  await assert.rejects(missing.repository.stageApplication(token, input), { code: 'TA_ACCOUNT_UNVERIFIED' });
  assert.equal(missing.calls.some(call => call.sql.includes('INSERT INTO applications')), false);
  const confirmed = fixture({ binding: { id: 101 } });
  await confirmed.repository.stageApplication(token, input);
  assert.equal(confirmed.calls.some(call => call.sql.includes('INSERT INTO applications')), true);
});

test('03 refund, supplement and cancellation do not bind a missing share class', async () => {
  for (const businessCode of ['040', '041', '052']) {
    const trade = { AppSheetSerialNo: `20261003${businessCode}`, BusinessCode: businessCode,
      DistributorCode: '306', TransactionDate: '20261003', TransactionTime: '120000',
      TransactionAccountID: '123456', TAAccountID: 'TA123', BranchCode: '306',
      FundCode: '000001',
      ...(businessCode === '052' ? { OriginalAppSheetNo: '202610030022' } : {
        CurrencyType: '156', ApplicationAmount: '100.00'
      }) };
    const { repository, calls } = fixture({ binding: { id: 101 } });
    await repository.stageApplication(token, { chatPublicId, casePublicId, sopVersionId: '61',
      channelId: '71', businessDate: '20261003', fileType: '03', record: trade });
    const fundLookup = calls.find(call => call.sql.includes('FROM case_generated_funds'));
    assert.equal(fundLookup.values.length, 4);
    assert.doesNotMatch(fundLookup.sql, /share_class=\?/);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO applications')), true);
  }
});

test('03 staging rejects an investor type that contradicts the confirmed customer', async () => {
  const trade = { AppSheetSerialNo: '202610030022', BusinessCode: '022', DistributorCode: '306',
    TransactionDate: '20261003', TransactionTime: '120000', TransactionAccountID: '123456',
    TAAccountID: 'TA123', BranchCode: '306', FundCode: '000001', CurrencyType: '156',
    ApplicationAmount: '100.00', ShareClass: 'A', ChargeType: '0', IndividualOrInstitution: '1' };
  const { repository, calls } = fixture({ binding: { id: 101 } });
  await assert.rejects(repository.stageApplication(token, { chatPublicId, casePublicId,
    sopVersionId: '61', channelId: '71', businessDate: '20261003', fileType: '03', record: trade }),
  { code: 'APPLICATION_DATA_MISMATCH' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO applications')), false);
});

test('04 matching uses the mapped confirmation code', async () => {
  const source = { AppSheetSerialNo: '202610030022', BusinessCode: '022', DistributorCode: '306',
    TransactionDate: '20261003', TransactionAccountID: '123456', TAAccountID: 'TA123',
    FundCode: '000001', ShareClass: 'A' };
  const returnItem = { id: 91, channel_id: 71, file_type: '04',
    record_json: { ...source, BusinessCode: '122' }, match_status: 'UNMATCHED' };
  const application = { id: 101, chat_id: 41, case_id: 51, app_no: source.AppSheetSerialNo,
    business_code: '022', file_type: '03', record_json: source, status: 'WAITING_RETURN' };
  const { repository } = fixture({ returnItem, application });
  assert.deepEqual(await repository.matchReturnRecord(token, { returnRecordId: '91', applicationPublicId }), { matched: true });
});

test('incomplete 01 application never becomes READY', async () => {
  const { repository, calls } = fixture();
  await assert.rejects(repository.stageApplication(token, {
    chatPublicId, casePublicId, sopVersionId: '61', channelId: '71', businessDate: '20261003',
    fileType: '01', record: { AppSheetSerialNo: 'X', BusinessCode: '001', DistributorCode: '306' }
  }), { code: 'MISSING_APPLICATION_FIELD' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO applications')), false);
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
  assert.deepEqual(calls.find(call => call.sql.includes('UPDATE applications')).values, [31, 41, 101]);
  const pending = fixture({ batchApplications, pendingCount: 1 });
  await assert.rejects(pending.repository.createOutboundBatch(token, {
    chatPublicId, channelId: '71', businessDate: '20261003', applicationPublicIds: [applicationPublicId]
  }), { code: 'SOP_NOT_LOCKED' });
  assert.equal(pending.calls.some(call => call.sql.includes('INSERT INTO exchange_batches')), false);
  const noData = fixture({ batchApplications, missingReviewCount: 1 });
  await assert.rejects(noData.repository.createOutboundBatch(token, {
    chatPublicId, channelId: '71', businessDate: '20261003', applicationPublicIds: [applicationPublicId]
  }), { code: 'DATA_NOT_CONFIRMED' });
});

test('batch date remains the database calendar date across a UTC+8 midnight', async () => {
  const base = { id: 101, public_id: applicationPublicId, status: 'READY',
    channel_id: 71, file_type: '01' };
  const { repository } = fixture({ batchApplications: sql => [{ ...base,
    business_date: sql.includes('DATE_FORMAT(a.business_date')
      ? '2026-10-03' : new Date('2026-10-02T16:00:00.000Z') }] });
  const result = await repository.createOutboundBatch(token, {
    chatPublicId, channelId: '71', businessDate: '20261003', applicationPublicIds: [applicationPublicId]
  });
  assert.equal(result.batchNumber, 1);
});

test('batch replay accepts the exact member set and rejects a subset', async () => {
  const priorBatchPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccf';
  const anotherPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837cd0';
  const members = [applicationPublicId, anotherPublicId].map((publicId, index) => ({
    id: 101 + index, public_id: publicId, status: 'GENERATED',
    business_date: '2026-10-03', channel_id: 71, file_type: '01',
    prior_batch_public_id: priorBatchPublicId
  }));
  const input = { chatPublicId, channelId: '71', businessDate: '20261003' };
  const full = fixture({ batchApplications: members, priorMembers: members });
  assert.deepEqual(await full.repository.createOutboundBatch(token, {
    ...input, applicationPublicIds: [applicationPublicId, anotherPublicId]
  }), { publicId: priorBatchPublicId, replayed: true });
  assert.equal(full.calls.some(call => call.sql.includes('INSERT INTO exchange_batches')), false);
  const subset = fixture({ batchApplications: [members[0]], priorMembers: members });
  await assert.rejects(subset.repository.createOutboundBatch(token, {
    ...input, applicationPublicIds: [applicationPublicId]
  }), { code: 'BATCH_APPLICATION_MISMATCH' });
});

test('generates a real 01 file from one scoped batch and replays its stored result', async () => {
  const { repository, calls } = fixture({ generatedApps: [{
    id: 101, file_type: '01', status: 'BATCHED', record_json: record
  }] });
  const generated = await repository.generateOutboundFiles(token, {
    chatPublicId, batchPublicId: '9b039fda-601d-4f3c-b065-0f7bf0837ccf'
  });
  assert.equal(generated.files.length, 1);
  assert.equal(generated.files[0].fileName, 'OFD_306_27_20261003_01_001.TXT');
  const insert = calls.find(call => call.sql.includes('INSERT INTO exchange_files'));
  const parsed = parseDataFile(insert.values.at(-2));
  assert.equal(parsed.fileType, '01');
  assert.equal(parsed.records[0].TransactionAccountID, '123456');
  assert.equal(generated.files[0].sha256, crypto.createHash('sha256').update(insert.values.at(-2)).digest('hex'));
  assert.equal(calls.some(call => call.sql.includes("SET status='GENERATED'")), true);

  const replay = fixture({ generatedBatch: { status: 'GENERATED', id: 111 },
    generatedFiles: [{ id: 81, file_name: generated.files[0].fileName,
      file_type: '01', content_sha256: generated.files[0].sha256, record_count: 1 }] });
  assert.equal((await replay.repository.generateOutboundFiles(token, {
    chatPublicId, batchPublicId: '9b039fda-601d-4f3c-b065-0f7bf0837ccf'
  })).replayed, true);
});

test('encodes an eligible 03 application as a separate file', async () => {
  const trade = { AppSheetSerialNo: '202610030022', BusinessCode: '022', DistributorCode: '306',
    TransactionDate: '20261003', TransactionTime: '120000', TransactionAccountID: '123456',
    TAAccountID: 'TA123', BranchCode: '306', FundCode: '000001', CurrencyType: '156',
    ApplicationAmount: '100.00', ShareClass: 'A', ChargeType: '0' };
  const { repository, calls } = fixture({ generatedApps: [{
    id: 102, file_type: '03', status: 'BATCHED', record_json: trade
  }] });
  const result = await repository.generateOutboundFiles(token, {
    chatPublicId, batchPublicId: '9b039fda-601d-4f3c-b065-0f7bf0837ccf'
  });
  assert.equal(result.files[0].fileType, '03');
  const raw = calls.find(call => call.sql.includes('INSERT INTO exchange_files')).values.at(-2);
  const parsed = parseDataFile(raw);
  assert.equal(parsed.records[0].TAAccountID, 'TA123');
  assert.equal(parsed.records[0].ApplicationAmount, '100.00');
});

test('application data must match confirmed Case tables', async () => {
  const { repository, calls } = fixture({ sourceAccount: null });
  await assert.rejects(repository.stageApplication(token, {
    chatPublicId, casePublicId, sopVersionId: '61', channelId: '71',
    businessDate: '20261003', fileType: '01', record
  }), { code: 'APPLICATION_DATA_MISMATCH' });
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO applications')), false);
});
