import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveApplicationPreparation } from '../../case-agent/src/application-preparation.js';
import { createApplicationPreparationService } from '../src/prepare-applications.js';
import { boundPreparationHistory } from '../../platform-store/src/application-preparation.js';

const opening = { key: 'open1', fileType: '01', businessCode: '001', accountId: '2',
  fundId: null, targetFundId: null, businessDate: '20261005', fields: {
    TransactionTime: '120000', CertificateType: '0', CertificateNo: 'TESTCERT1' } };
const trade = { ...opening, key: 'trade1', fileType: '03', businessCode: '022', fundId: '3',
  fields: { TransactionTime: '120000', ApplicationAmount: '100.00', CurrencyType: '156', ChargeType: '0' } };
const input = { token: 'session', chatPublicId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  casePublicId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
function fixture({ intents = [opening, trade], confirmed = true, failOnce = false, fileError = null,
  mysqlJsonOrder = false, reply = '按方案准备', channels = [{ id: '7', distributorCode: '306', protocolVersion: '22' }] } = {}) {
  let saved = { phase: 'NOT_STARTED', revision: 0, intents: [], turns: [], stagedKeys: [], files: [] };
  const applications = [], files = [], bindings = [], calls = [];
  const repository = { generatedData: async () => ({ reviewStatus: confirmed ? 'CONFIRMED' : 'PENDING_REVIEW',
    planVersionId: '5', customers: [{ id: '1', name: '测试客户', investor_type: '1' }],
    accounts: [{ id: '2', customer_id: '1', account_no: 'TESTACCOUNT1', branch_code: '306' }],
    funds: [{ id: '3', fund_code: '000001', share_class: 'A' }], holdings: [] }),
  getLatestSopProposal: async () => ({ status: 'LOCKED', proposal: { objective: '开户后申购' } }) };
  const preparations = { read: async () => structuredClone(saved), save: async (token, args) => {
    assert.equal(args.revision, saved.revision);
    saved = { ...boundPreparationHistory(structuredClone(args.state)), revision: saved.revision + 1 };
    if (mysqlJsonOrder) saved.intents = saved.intents.map(item => Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b))));
    return structuredClone(saved);
  } };
  const exchangeRepository = {
    listChannels: async () => ({ channels }),
    listCaseBindings: async () => ({ bindings }),
    stageApplication: async (token, app) => {
      calls.push(['stage', app.record.AppSheetSerialNo]);
      const prior = applications.find(item => item.applicationNumber === app.record.AppSheetSerialNo);
      if (prior) return { publicId: prior.publicId, replayed: true };
      applications.push({ publicId: String(applications.length + 1), applicationNumber: app.record.AppSheetSerialNo,
        status: 'READY', fileType: app.fileType, channelId: app.channelId, businessDate: app.businessDate });
      return { publicId: String(applications.length) };
    },
    listCaseApplications: async () => ({ applications }),
    createOutboundBatch: async (token, args) => {
      const id = `batch${files.length + 1}`;
      calls.push(['batch', args.applicationPublicIds]);
      applications.filter(item => args.applicationPublicIds.includes(item.publicId)).forEach(item => {
        item.status = 'BATCHED'; item.batchPublicId = id;
      }); return { publicId: id };
    },
    generateOutboundFiles: async (token, { batchPublicId }) => {
      if (fileError) throw fileError;
      if (failOnce) { failOnce = false; throw new Error('interrupted'); }
      const apps = applications.filter(item => item.batchPublicId === batchPublicId);
      apps.forEach(item => { item.status = 'GENERATED'; });
      if (!files.some(file => file.batchPublicId === batchPublicId)) {
        files.push({ id: String(files.length + 1), batchPublicId, fileType: apps[0].fileType });
      }
    },
    listOutboundFiles: async () => ({ files }),
  };
  const service = createApplicationPreparationService({ repository, preparations, exchangeRepository,
    derive: async context => { calls.push(['derive', context.userInput]); return {
      ...await deriveApplicationPreparation(async () => JSON.stringify({ reply, intents: structuredClone(intents), questions: [] }), context) }; } });
  return { service, applications, files, bindings, calls, setIntents: next => { intents = next; }, setFileError: next => { fileError = next; } };
}

test('confirmed data generates 01 and waits for 02 before generating 03 once', async () => {
  const f = fixture();
  const first = await f.service.prepare(input);
  assert.equal(first.phase, 'WAITING_TA'); assert.deepEqual(f.files.map(file => file.fileType), ['01']);
  f.bindings.push({ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' });
  const second = await f.service.prepare({ ...input, revision: first.revision });
  assert.equal(second.phase, 'GENERATED'); assert.deepEqual(f.files.map(file => file.fileType), ['01','03']);
  await f.service.prepare(input);
  assert.equal(f.files.length, 2); assert.equal(f.applications.length, 2);
  assert.equal(f.calls.filter(call => call[0] === 'derive').length, 3);
});

test('continuing after 02 replans and recovers a 03 omitted from the earlier model reply', async () => {
  const f = fixture({ intents: [opening], reply: '03申购待成功02回传后继续' });
  const first = await f.service.prepare(input);
  assert.deepEqual(f.files.map(file => file.fileType), ['01']);
  assert.match(first.reply, /03申购待成功02回传/);
  assert.doesNotMatch(first.reply, /已按确认的 Plan 和数据生成/);
  f.bindings.push({ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' });
  f.setIntents([opening, trade]);
  const continued = await f.service.prepare({ ...input, revision: first.revision });
  assert.equal(continued.phase, 'GENERATED');
  assert.deepEqual(f.files.map(file => file.fileType), ['01', '03']);
  assert.equal(f.calls.filter(call => call[0] === 'derive').length, 2);
  await f.service.prepare(input);
  assert.equal(f.applications.length, 2); assert.equal(f.files.length, 2);
  f.setIntents([{ ...opening, fields: { ...opening.fields, CertificateNo: 'CHANGED' } }, trade]);
  await assert.rejects(f.service.prepare(input), { code: 'APPLICATION_ALREADY_STAGED' });
  assert.equal(f.applications.length, 2);
});

test('long Chinese follow-ups remain writable and preserve pending application material', async () => {
  const incomplete = { ...opening, fields: { TransactionTime: '120000' } };
  const f = fixture({ intents: [incomplete], reply: '补'.repeat(4000) });
  let state = await f.service.prepare(input);
  for (let i = 0; i < 30; i++) {
    state = await f.service.prepare({ ...input, revision: state.revision,
      userInput: `${i}` + '资'.repeat(3998) });
    assert.equal(state.phase, 'NEEDS_INPUT');
    assert.ok(Buffer.byteLength(JSON.stringify(state)) < 240000);
    assert.deepEqual(state.intents[0].fields, incomplete.fields);
  }
  assert.ok(state.turnsOmitted > 0);
  assert.match(state.turns.at(-1).userInput, /^29/);
  f.setIntents([opening]);
  state = await f.service.prepare({ ...input, revision: state.revision, userInput: '补齐证件' });
  assert.equal(state.phase, 'GENERATED');
  assert.equal(f.applications.length, 1);
  assert.equal(f.files.length, 1);
});

test('missing certificate material supports follow-up and rejects changes to a staged intent', async () => {
  const f = fixture({ intents: [{ ...opening, fields: {} }] });
  const pending = await f.service.prepare(input);
  assert.equal(pending.phase, 'NEEDS_INPUT'); assert.equal(f.applications.length, 0);
  f.setIntents([opening]);
  const ready = await f.service.prepare({ ...input, revision: pending.revision, userInput: '提供测试证件及模拟时间' });
  assert.equal(ready.phase, 'GENERATED'); assert.equal(ready.turns.at(-1).userInput, '提供测试证件及模拟时间');
  f.setIntents([{ ...opening, fields: { ...opening.fields, CertificateNo: 'CHANGED' } }]);
  await assert.rejects(f.service.prepare({ ...input, userInput: '改变旧申请' }), { code: 'APPLICATION_ALREADY_STAGED' });
  assert.equal(f.applications.length, 1);
});

test('file generation interruption resumes saved intents without another model call', async () => {
  const f = fixture({ intents: [opening], failOnce: true });
  await assert.rejects(f.service.prepare(input), /interrupted/);
  await assert.rejects(f.service.prepare({ ...input, userInput: '改内容' }), { code: 'APPLICATION_PREPARATION_CONFLICT' });
  const recovered = await f.service.prepare(input);
  assert.equal(recovered.phase, 'GENERATED'); assert.equal(f.files.length, 1); assert.equal(f.applications.length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'derive').length, 1);
});

test('unconfirmed data and stale preparation versions cannot invoke the model', async () => {
  const f = fixture({ confirmed: false });
  await assert.rejects(f.service.prepare(input), { code: 'DATA_NOT_CONFIRMED' });
  assert.equal(f.calls.length, 0);
  const confirmed = fixture();
  await assert.rejects(confirmed.service.prepare({ ...input, revision: 99 }), { code: 'APPLICATION_PREPARATION_CONFLICT' });
  assert.equal(confirmed.calls.length, 0);
});

test('invalid unbound trade stays in NEEDS_INPUT and can be corrected without changing the staged opening', async () => {
  const f = fixture({ intents: [opening, { ...trade, businessDate: '20260230' }] });
  const pending = await f.service.prepare(input);
  assert.equal(pending.phase, 'NEEDS_INPUT');
  assert.match(pending.questions.join(''), /有效日历日期/);
  assert.deepEqual(pending.stagedKeys, ['open1']);
  f.setIntents([opening, trade]);
  const corrected = await f.service.prepare({ ...input, revision: pending.revision, userInput: '申购日期改为20261005' });
  assert.equal(corrected.phase, 'WAITING_TA');
  assert.equal(f.applications.length, 1);
  f.bindings.push({ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' });
  assert.equal((await f.service.prepare(input)).phase, 'GENERATED');
  assert.equal(f.applications.length, 2);
});


test('unchanged staged intents survive MySQL property order when material is supplemented', async () => {
  const incomplete = { ...trade, fields: { ...trade.fields, ApplicationAmount: '' } };
  const f = fixture({ intents: [opening, incomplete], mysqlJsonOrder: true });
  const pending = await f.service.prepare(input);
  assert.equal(pending.phase, 'NEEDS_INPUT'); assert.deepEqual(pending.stagedKeys, ['open1']);
  f.setIntents([opening, trade]);
  const updated = await f.service.prepare({ ...input, revision: pending.revision, userInput: '申购金额100.00元' });
  assert.equal(updated.phase, 'WAITING_TA'); assert.equal(f.applications.length, 1);
  f.setIntents([{ ...opening, fields: { ...opening.fields, CertificateNo: 'DIFFERENT' } }, trade]);
  await assert.rejects(f.service.prepare({ ...input, userInput: '实际改写已生成申请' }),
    { code: 'APPLICATION_ALREADY_STAGED' });
});

test('material submitted before selecting a channel is retained until successfully derived', async () => {
  const f = fixture({ intents: [opening], channels: [
    { id: '7', distributorCode: '306', protocolVersion: '22' },
    { id: '8', distributorCode: '307', protocolVersion: '22' },
  ] });
  const pending = await f.service.prepare({ ...input, userInput: '证件TESTCERT1，日期20261005，时间120000' });
  assert.equal(pending.phase, 'NEEDS_INPUT');
  assert.equal(f.calls.length, 0);
  f.setIntents([{ ...opening, key: 'invalid key' }]);
  await assert.rejects(f.service.prepare({ ...input, revision: pending.revision, channelId: '7' }),
    { code: 'APPLICATION_PREPARATION_INVALID' });
  assert.equal((await f.service.read(input.token, input)).pendingUserInput, pending.pendingUserInput);
  f.setIntents([opening]);
  const ready = await f.service.prepare({ ...input, revision: pending.revision, channelId: '7' });
  assert.equal(ready.phase, 'GENERATED');
  assert.equal(ready.turns.at(-1).userInput, pending.pendingUserInput);
  assert.equal(ready.pendingUserInput, '');
  assert.equal(f.calls.filter(call => call[0] === 'derive').at(-1)[1], pending.pendingUserInput);
});

test('file sequence exhaustion persists an operational recovery state and retries frozen applications', async () => {
  const f = fixture({ intents: [opening], fileError: Object.assign(new Error('exhausted'),
    { code: 'FILE_SEQUENCE_EXHAUSTED', status: 409 }) });
  const pending = await f.service.prepare(input);
  assert.equal(pending.phase, 'WAITING_OPERATION');
  assert.equal(pending.operationError.code, 'FILE_SEQUENCE_EXHAUSTED');
  assert.deepEqual(pending.stagedKeys, ['open1']);
  assert.equal(f.applications.length, 1);
  assert.equal(f.applications[0].status, 'BATCHED');
  assert.equal((await f.service.prepare(input)).phase, 'WAITING_OPERATION');
  await assert.rejects(f.service.prepare({ ...input, userInput: '改日期' }),
    { code: 'APPLICATION_PREPARATION_CONFLICT' });
  f.setFileError(null);
  const recovered = await f.service.prepare(input);
  assert.equal(recovered.phase, 'GENERATED');
  assert.equal(recovered.operationError, undefined);
  assert.equal(f.files.length, 1); assert.equal(f.applications.length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'derive').length, 1);
});
