import assert from 'node:assert/strict';
import test from 'node:test';
import { compileApplicationIntents, deriveApplicationPreparation } from '../src/application-preparation.js';

const data = { customers: [{ id: '1', name: '测试客户', investor_type: '1' }],
  accounts: [{ id: '2', customer_id: '1', account_no: 'TESTACCOUNT1', branch_code: '306' }],
  funds: [{ id: '3', fund_code: '000001', share_class: 'A' }], holdings: [] };
const channel = { id: '7', distributorCode: '306', taCode: '27', protocolVersion: '22' };
const opening = { key: 'open1', fileType: '01', businessCode: '001', accountId: '2',
  fundId: null, targetFundId: null, businessDate: '20261005',
  fields: { CertificateType: '0', CertificateNo: 'TESTCERT1', TransactionTime: '120000' } };
const trade = { ...opening, key: 'trade1', fileType: '03', businessCode: '022', fundId: '3',
  fields: { TransactionTime: '120000', ApplicationAmount: '100.00', CurrencyType: '156', ChargeType: '0' } };
const compile = (intents, bindings = []) => compileApplicationIntents({ intents, bindings, data, channel,
  casePublicId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });

test('intent compilation owns source identity and deterministic application numbers', () => {
  const first = compile([opening]);
  const record = first.records[0].record;
  assert.equal(record.InvestorName, '测试客户'); assert.equal(record.TransactionAccountID, 'TESTACCOUNT1');
  assert.equal(record.IndividualOrInstitution, '1');
  assert.equal(record.AppSheetSerialNo.length, 24);
  assert.deepEqual(compile([opening]), first);
  assert.throws(() => compile([{ ...opening, fields: { ...opening.fields, TAAccountID: 'INVENTED' } }]),
    { code: 'APPLICATION_PREPARATION_INVALID' });
  assert.throws(() => compile([{ ...opening, accountId: '99' }]),
    { code: 'APPLICATION_PREPARATION_INVALID' });
});

test('missing material asks for input while 03 waits for verified 02 binding', () => {
  const missing = compile([{ ...opening, businessDate: null, fields: {} }, trade]);
  assert.equal(missing.records.length, 0);
  assert.match(missing.questions[0], /模拟证件号/); assert.match(missing.questions[0], /业务日期/);
  assert.deepEqual(missing.waiting, ['trade1']);
  const ready = compile([trade], [{ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' }]);
  assert.equal(ready.records[0].record.TAAccountID, 'TA000001');
  assert.equal(ready.records[0].record.FundCode, '000001');
  assert.equal(ready.records[0].record.ApplicationAmount, '100.00');
});

test('invalid material remains editable before and after a TA binding exists', () => {
  const binding = [{ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' }];
  for (const bindings of [[], binding]) {
    const date = compile([{ ...trade, businessDate: '20260230' }], bindings);
    assert.equal(date.records.length, 0); assert.match(date.questions.join(''), /有效日历日期/);
    const amount = compile([{ ...trade, fields: { ...trade.fields, ApplicationAmount: '0.00' } }], bindings);
    assert.equal(amount.records.length, 0); assert.match(amount.questions.join(''), /大于零/);
    const format = compile([{ ...trade, fields: { ...trade.fields, TransactionTime: '120000123' } }], bindings);
    assert.equal(format.records.length, 0); assert.match(format.questions.join(''), /格式/);
  }
});

test('target TA identity cannot be invented by a conversion intent', () => {
  assert.throws(() => compile([{ ...trade, businessCode: '036', targetFundId: '3',
    fields: { ...trade.fields, ApplicationVol: '1.00', TargetTAAccountID: 'INVENTED_TA' } }],
  [{ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' }]),
  { code: 'APPLICATION_PREPARATION_INVALID' });
});

test('the model adapter accepts only structured intents and passes scoped context', async () => {
  const context = { plan: { objective: '开户' }, data, previous: { turns: [] }, userInput: '测试证件' };
  const output = await deriveApplicationPreparation(async input => {
    assert.deepEqual(JSON.parse(input.user), context);
    return JSON.stringify({ reply: '准备开户', intents: [opening], questions: [] });
  }, context);
  assert.equal(output.intents[0].key, 'open1');
  await assert.rejects(deriveApplicationPreparation(async () => JSON.stringify({ reply: '生成完成',
    intents: [opening, opening], questions: [] }), context), { code: 'APPLICATION_PREPARATION_INVALID' });
});


test('target account identity comes only from a confirmed Case account reference', () => {
  const transfer = { ...trade, businessCode: '058', targetAccountId: '2',
    fields: { TransactionTime: '120000', ApplicationVol: '1.00', ChargeType: '0' } };
  const bindings = [{ channelId: '7', transactionAccountId: 'TESTACCOUNT1', taAccountId: 'TA000001' }];
  const ready = compile([transfer], bindings);
  assert.equal(ready.records[0].record.TargetTransactionAccountID, 'TESTACCOUNT1');
  assert.equal(ready.records[0].record.TargetBranchCode, '306');
  assert.throws(() => compile([{ ...transfer, targetAccountId: '99' }], bindings),
    { code: 'APPLICATION_PREPARATION_INVALID' });
  assert.throws(() => compile([{ ...transfer, targetAccountId: null,
    fields: { ...transfer.fields, TargetTransactionAccountID: '999999999999' } }], bindings),
  { code: 'APPLICATION_PREPARATION_INVALID' });
  const missing = compile([{ ...transfer, targetAccountId: null }], bindings);
  assert.equal(missing.records.length, 0); assert.match(missing.questions.join(''), /目标交易账号/);
});
