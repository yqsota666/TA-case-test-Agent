import assert from 'node:assert/strict';
import test from 'node:test';
import { planReturnConfirmation } from '../src/return-confirmation.js';

const channel = { distributorCode: '306' };
const common = { AppSheetSerialNo: 'APP20261006000001', TransactionDate: '20261006',
  TransactionTime: '093000', TransactionAccountID: 'SALE00000001', DistributorCode: '306', BranchCode: '0001' };
function opening() {
  return { channel, returnType: '02', application: { fileType: '01', businessCode: '001', status: 'DELIVERED',
    record: { ...common, BusinessCode: '001', InvestorName: '合成开户客户', IndividualOrInstitution: '1',
      CertificateType: '0', CertificateNo: 'SYNTHETIC001' } },
  record: { ...common, BusinessCode: '101', ReturnCode: '0000', TransactionCfmDate: '20261007',
    TAAccountID: 'TA00000001', TASerialNO: 'TA20261007000001' } };
}
function subscription() {
  return { channel, returnType: '04', application: { fileType: '03', businessCode: '022', status: 'WAITING_RETURN',
    record: { ...common, BusinessCode: '022', TAAccountID: 'TA00000001', FundCode: '000001', ShareClass: 'A',
      CurrencyType: '156', ApplicationAmount: '450.00' } },
  record: { ...common, BusinessCode: '122', ReturnCode: '0000', TransactionCfmDate: '20261007',
    TAAccountID: 'TA00000001', TASerialNO: 'TA20261007000002', FundCode: '000001', ShareClass: 'A',
    CurrencyType: '156', ApplicationAmount: '450.00', ConfirmedAmount: '449.00', ConfirmedVol: '400.00', NAV: '1.12250000' } };
}

test('successful 02 creates only account effect using request identity and actual returned TA account', () => {
  const input = opening();
  const plan = planReturnConfirmation(input);
  assert.equal(plan.outcome, 'CONFIRMED');
  assert.deepEqual(plan.accountEffect, { transactionAccountId: 'SALE00000001', taAccountId: 'TA00000001',
    investorName: '合成开户客户', investorType: '1', certificateType: '0', certificateNo: 'SYNTHETIC001', branchCode: '0001' });
  assert.equal(plan.transactionEffect, null); assert.equal(plan.holdingEffect, null);
  assert.equal(input.application.record.TAAccountID, undefined);
});

test('successful 04 preserves requested values and applies only exact returned volume and amount', () => {
  const input = subscription();
  const plan = planReturnConfirmation(input);
  assert.deepEqual(plan.transactionEffect, { businessCode: '022', fundCode: '000001', shareClass: 'A',
    confirmedAmount: '449.00', confirmedVolume: '400.00', nav: '1.12250000', confirmationDate: '2026-10-07' });
  assert.deepEqual(plan.holdingEffect, { fundCode: '000001', shareClass: 'A', volumeDelta: '400.00' });
  assert.equal(plan.accountEffect, null);
  assert.equal(input.application.record.ApplicationAmount, '450.00');
  assert.equal('balanceEffect' in plan, false);
});

test('non-success 02 or 04 rejects application with no account or holding effect', () => {
  for (const input of [opening(), subscription()]) {
    Object.assign(input.record, { ReturnCode: '1001', TASerialNO: null, ConfirmedAmount: null, ConfirmedVol: null, NAV: null });
    if (input.returnType === '02') input.record.TAAccountID = null;
    assert.deepEqual(planReturnConfirmation(input), { outcome: 'FAILED', returnCode: '1001', applicationStatus: 'FAILED',
      accountEffect: null, transactionEffect: null, holdingEffect: null });
  }
});

test('all confirmation identities must match request and sales channel exactly', () => {
  for (const factory of [opening, subscription]) {
    const fields = ['AppSheetSerialNo', 'DistributorCode', 'TransactionDate', 'TransactionAccountID', 'BranchCode', 'BusinessCode',
      ...(factory === subscription ? ['TAAccountID', 'FundCode', 'ShareClass', 'CurrencyType', 'ApplicationAmount'] : [])];
    for (const field of fields) {
      const input = factory(); input.record[field] = field === 'ApplicationAmount' ? '449.00' : 'WRONG';
      assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_MISMATCH' }, field);
    }
    const input = factory(); input.channel = { distributorCode: '999' };
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_MISMATCH' });
  }
  for (const field of ['CertificateType', 'CertificateNo', 'IndividualOrInstitution', 'InvestorName']) {
    const input = opening(); input.record[field] = 'OTHER';
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_MISMATCH' }, field);
  }
});

test('only delivered opening and subscription applications can have business effects', () => {
  for (const status of ['PREPARED', 'GENERATED', 'CONFIRMED', 'FAILED']) {
    const input = opening(); input.application.status = status;
    assert.throws(() => planReturnConfirmation(input), { code: 'APPLICATION_NOT_DELIVERED' });
  }
  for (const [fileType, businessCode] of [['01', '002'], ['03', '024'], ['03', '020']]) {
    const input = opening(); Object.assign(input.application, { fileType, businessCode });
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_UNSUPPORTED' });
  }
  const input = opening(); input.returnType = '04';
  assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_MISMATCH' });
});

test('success cannot invent missing account identity, TA reference or confirmation dates', () => {
  for (const field of ['TAAccountID', 'TASerialNO', 'TransactionCfmDate']) {
    const input = opening(); delete input.record[field];
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_INCOMPLETE' }, field);
  }
  for (const field of ['InvestorName', 'IndividualOrInstitution', 'CertificateType', 'CertificateNo']) {
    const input = opening(); delete input.application.record[field];
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_INCOMPLETE' }, field);
  }
  for (const badDate of ['20260230', '20261005', 'NaN', '20261301']) {
    const input = opening(); input.record.TransactionCfmDate = badDate;
    assert.throws(() => planReturnConfirmation(input));
  }
  for (const badCode of [null, '', ' 0000', '00000', 'ERR!']) {
    const input = opening(); input.record.ReturnCode = badCode;
    assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_INCOMPLETE' });
  }
});

test('success requires precise positive amount, volume and NAV; partial terminal results are unsupported', () => {
  for (const field of ['ConfirmedAmount', 'ConfirmedVol', 'NAV']) {
    for (const bad of [null, '', 'NaN', 'Infinity', '-1', '0', '1e2', 100, '1.000000000', '100000000000000']) {
      const input = subscription(); input.record[field] = bad;
      assert.throws(() => planReturnConfirmation(input), field + String(bad));
    }
  }
  const over = subscription(); over.record.ConfirmedAmount = '450.01';
  assert.throws(() => planReturnConfirmation(over), { code: 'RETURN_CONFIRMATION_VALUES' });
  for (const value of ['0', '2']) {
    const partial = subscription(); partial.record.BusinessFinishFlag = value;
    assert.throws(() => planReturnConfirmation(partial), { code: 'RETURN_CONFIRMATION_UNSUPPORTED' });
  }
});

test('money comparison is exact beyond JavaScript integer precision', () => {
  const input = subscription();
  input.application.record.ApplicationAmount = '99999999999999.99';
  input.record.ApplicationAmount = '99999999999999.99';
  input.record.ConfirmedAmount = '99999999999999.98';
  assert.equal(planReturnConfirmation(input).transactionEffect.confirmedAmount, '99999999999999.98');
  input.application.record.ApplicationAmount = '99999999999999.98';
  input.record.ApplicationAmount = '99999999999999.98';
  input.record.ConfirmedAmount = '99999999999999.99';
  assert.throws(() => planReturnConfirmation(input), { code: 'RETURN_CONFIRMATION_VALUES' });
});
