import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveDataSpecification, parseDataSpecification } from '../src/data-generation.js';

const proposal = { objective: '创建一名模拟客户及基金', preconditions: [],
  scenarios: [{ title: '数据核对', setup: '客户和基金', action: '检查账户归属',
    expected: '一致', evidence: '客户与基金记录' }], openQuestions: [] };

test('confirmed Plan is converted to linked data without accepting invented account numbers', async () => {
  const completion = async ({ system, user }) => {
    assert.match(system, /交易账号由系统生成/);
    assert.deepEqual(JSON.parse(user), proposal);
    return JSON.stringify({ customers: [{ name: '模拟客户甲', investorType: '1',
      simulatedBalance: '100000.00' }], accounts: [{ customerIndex: 0, branchCode: '305' }],
    funds: [{ fundCode: '990901', fundName: '模拟基金', shareClass: 'A', nav: '1.00000000' }],
    missing: [] });
  };
  const result = await deriveDataSpecification(completion, proposal);
  assert.equal(result.accounts[0].customerIndex, 0);
  assert.equal(result.funds[0].nav, '1.00000000');
});

test('missing Plan details and broken customer references stop before data writes', () => {
  assert.throws(() => parseDataSpecification(JSON.stringify({ customers: [], accounts: [], funds: [],
    missing: ['客户类型'] })), { code: 'DATA_INPUT_REQUIRED' });
  assert.throws(() => parseDataSpecification(JSON.stringify({ customers: [],
    accounts: [{ customerIndex: 0, branchCode: '305' }], funds: [], missing: [] })),
  { code: 'DATA_SPEC_INVALID' });
});

test('decimal values use MySQL canonical form before generation validates stored rows', () => {
  const data = parseDataSpecification(JSON.stringify({
    customers: [{ name: '模拟客户甲', investorType: '1', simulatedBalance: '0001.00' }],
    accounts: [{ customerIndex: 0, branchCode: '305' }],
    funds: [{ fundCode: '990901', fundName: '模拟基金', shareClass: 'A', nav: '0001.00000000' }],
    holdings: [{ accountIndex: 0, fundIndex: 0, totalVolume: '0001.00000000' }], missing: [],
  }));
  assert.equal(data.customers[0].simulatedBalance, '1.00');
  assert.equal(data.funds[0].nav, '1.00000000');
  assert.equal(data.holdings[0].totalVolume, '1.00000000');
});
