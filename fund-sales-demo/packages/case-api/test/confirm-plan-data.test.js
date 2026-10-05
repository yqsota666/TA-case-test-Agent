import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmPlanWithData } from '../src/confirm-plan-data.js';

const input = { token: 'session', chatPublicId: 'chat', casePublicId: 'case', versionNumber: 2 };
const pending = { status: 'PENDING_CONFIRMATION', versionNumber: 2,
  proposal: { objective: '核对数据' } };

test('missing data input leaves the Plan pending so the user can revise it', async () => {
  const calls = [];
  const confirmPlan = createConfirmPlanWithData({
    repository: { getLatestSopProposal: async () => pending },
    derive: async () => { calls.push('derive'); throw Object.assign(new Error('缺少客户类型'),
      { code: 'DATA_INPUT_REQUIRED' }); },
    confirm: async () => { calls.push('confirm'); },
    executeData: async () => { calls.push('execute'); },
  });
  await assert.rejects(confirmPlan(input), { code: 'DATA_INPUT_REQUIRED' });
  assert.deepEqual(calls, ['derive']);
});

test('a valid data definition is generated before Plan locking and passed to execution', async () => {
  const calls = [];
  const specification = { customers: [{ name: '模拟客户' }] };
  const confirmPlan = createConfirmPlanWithData({
    repository: { getLatestSopProposal: async () => pending },
    derive: async plan => { assert.deepEqual(plan, pending.proposal);
      calls.push('derive'); return specification; },
    confirm: async () => { calls.push('confirm'); },
    executeData: async args => { assert.equal(args.specification, specification);
      calls.push('execute'); return { reviewStatus: 'PENDING_REVIEW' }; },
  });
  const result = await confirmPlan(input);
  assert.deepEqual(calls, ['derive', 'confirm', 'execute']);
  assert.equal(result.data.reviewStatus, 'PENDING_REVIEW');
});

test('a failed data write can be retried through the same Plan confirmation request', async () => {
  let status = 'PENDING_CONFIRMATION';
  let derivations = 0;
  let attempts = 0;
  const confirmPlan = createConfirmPlanWithData({
    repository: { getLatestSopProposal: async () => ({ ...pending, status }) },
    derive: async () => { derivations += 1; return { customers: [] }; },
    confirm: async () => { status = 'LOCKED'; },
    executeData: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary database failure');
      return { reviewStatus: 'PENDING_REVIEW' };
    },
  });
  await assert.rejects(confirmPlan(input), /temporary database failure/);
  const result = await confirmPlan(input);
  assert.equal(result.phase, 'DATA_REVIEW');
  assert.equal(derivations, 1);
  assert.equal(attempts, 2);
});
