import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveDataReview, parseDataReviewReply } from '../src/data-review.js';

const empty = { customers: [], accounts: [], funds: [], holdings: [] };

test('a review turn receives only the confirmed Plan, current rows, and prior review turns', async () => {
  const data = { ...empty, customers: [{ id: '8', name: '模拟客户甲',
    investor_type: '1', simulated_balance: '100000.00' }] };
  const plan = { objective: '核对模拟客户' };
  const turns = [{ userInput: '先看看数据', reply: '请核对客户' }];
  const result = await deriveDataReview(async ({ system, user }) => {
    assert.match(system, /不要自行确认数据/);
    assert.deepEqual(JSON.parse(user), { plan, data: { ...empty, customers: data.customers },
      priorTurns: turns, userInput: '把余额改为 120000.00' });
    return JSON.stringify({ reply: '已调整余额，请核对。', changes: { ...empty,
      customers: [{ id: '8', name: '模拟客户甲', investorType: '1',
        simulatedBalance: '120000.00' }] } });
  }, { plan, data, turns, userInput: '把余额改为 120000.00' });
  assert.equal(result.changes.customers[0].simulatedBalance, '120000.00');
});

test('review reply cannot set a confirmation flag or an invented account number', () => {
  assert.throws(() => parseDataReviewReply(JSON.stringify({ reply: '已确认',
    changes: empty, confirmed: true })), { code: 'DATA_REVIEW_INVALID' });
  assert.throws(() => parseDataReviewReply(JSON.stringify({ reply: '已改账号',
    changes: { ...empty, accounts: [{ id: '1', customerId: '2', branchCode: '305',
      accountNo: '123456' }] } })), { code: 'DATA_REVIEW_INVALID' });
});

test('review can request a second account for an existing customer without choosing its account number', () => {
  const parsed = parseDataReviewReply(JSON.stringify({ reply: '已增加一个模拟交易账户，请核对。',
    changes: { ...empty, accounts: [{ id: null, customerId: '8', branchCode: '306' }] } }));
  assert.deepEqual(parsed.changes.accounts, [{ id: null, customerId: '8', branchCode: '306' }]);
});

test('an existing customer cannot silently change account branch code through a customer edit', () => {
  assert.throws(() => parseDataReviewReply(JSON.stringify({ reply: '已修改网点',
    changes: { ...empty, customers: [{ id: '8', name: '甲', investorType: '1',
      simulatedBalance: '100.00', branchCode: '306' }] } })),
  { code: 'DATA_REVIEW_INVALID' });
});
