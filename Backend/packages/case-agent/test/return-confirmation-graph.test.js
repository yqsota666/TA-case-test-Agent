import assert from 'node:assert/strict';
import test from 'node:test';
import { createReturnConfirmationGraph } from '../src/return-confirmation-graph.js';

const channel = { distributorCode: '306' };
function input(type = '02') {
  const opening = type === '02';
  const common = { AppSheetSerialNo: 'APP001', TransactionDate: '20261006', TransactionAccountID: 'SALE001',
    DistributorCode: '306', BranchCode: '0001', TAAccountID: 'TA001', FundCode: '000001', ShareClass: 'A', CurrencyType: '156' };
  return { returnType: type, application: { fileType: opening ? '01' : '03', businessCode: opening ? '001' : '022',
    status: 'DELIVERED', record: { ...common, BusinessCode: opening ? '001' : '022', InvestorName: '合成测试',
      IndividualOrInstitution: '1', CertificateType: '0', CertificateNo: 'SYNTHETIC001', ApplicationAmount: '450.00' } },
  record: { ...common, BusinessCode: opening ? '101' : '122', ReturnCode: '0000', TransactionCfmDate: '20261007',
    TASerialNO: 'TA_RETURN_001', ConfirmedAmount: '449.00', ConfirmedVol: '400.00', NAV: '1.12250000' } };
}

test('02 and 04 take separate verification and apply nodes, with 04 independent of new opening', async () => {
  const calls = [];
  const graph = createReturnConfirmationGraph({ channel,
    applyAccountConfirmation: async plan => { calls.push(['account', plan]); return { accountId: '1' }; },
    applyTransactionConfirmation: async plan => { calls.push(['transaction', plan]); return { transactionId: '1' }; } });
  assert.deepEqual(Object.keys(graph.getGraph().nodes).filter(name => !name.startsWith('__')).sort(),
    ['apply_account_confirmation', 'apply_transaction_confirmation', 'verify_account_return', 'verify_transaction_return']);
  const account = await graph.invoke(input());
  assert.equal(account.phase, 'APPLIED'); assert.deepEqual(account.applied, { accountId: '1' });
  const transaction = await graph.invoke(input('04'));
  assert.deepEqual(transaction.applied, { transactionId: '1' });
  assert.deepEqual(calls.map(call => call[0]), ['account', 'transaction']);
  assert.equal(calls[1][1].holdingEffect.volumeDelta, '400.00');
});

test('invalid confirmation never calls business apply; failed TA result applies only rejection', async () => {
  const effects = [];
  const apply = async plan => { effects.push(plan); return { outcome: plan.outcome }; };
  const graph = createReturnConfirmationGraph({ channel, applyAccountConfirmation: apply, applyTransactionConfirmation: apply });
  const bad = input('04'); bad.record.TAAccountID = 'OTHER';
  await assert.rejects(graph.invoke(bad), { code: 'RETURN_CONFIRMATION_MISMATCH' });
  assert.equal(effects.length, 0);
  const rejected = input('04'); rejected.record.ReturnCode = '1001';
  const result = await graph.invoke(rejected);
  assert.equal(result.applied.outcome, 'FAILED');
  assert.equal(effects[0].accountEffect, null); assert.equal(effects[0].transactionEffect, null); assert.equal(effects[0].holdingEffect, null);
});

test('storage error rejects graph instead of reporting application success', async () => {
  const apply = async () => { throw new Error('storage failed'); };
  const graph = createReturnConfirmationGraph({ channel, applyAccountConfirmation: apply, applyTransactionConfirmation: apply });
  await assert.rejects(graph.invoke(input()), /storage failed/);
});
