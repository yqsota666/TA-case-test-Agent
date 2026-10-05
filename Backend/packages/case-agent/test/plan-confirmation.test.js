import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanConfirmationGraph, decidePlan, stagePlanProposal } from '../src/index.js';

const proposal = {
  objective: '验证一项待确认的业务规则',
  preconditions: [],
  scenarios: [{ title: '边界场景', setup: '准备边界数据', action: '执行计算',
    expected: '结果符合已确认规则', evidence: '记录输入与输出' }],
  openQuestions: [],
};

test('a structured user decision controls confirmation without another model call', async () => {
  const calls = [];
  const repository = {
    async saveSopProposal(...args) { calls.push(['save', ...args]); return { versionNumber: 2 }; },
    async confirmSopProposal(...args) { calls.push(['confirm', ...args]); },
  };
  const scope = { token: 'session', chatPublicId: 'chat', casePublicId: 'case' };
  assert.deepEqual(await stagePlanProposal(repository, { ...scope, proposal }), { versionNumber: 2 });
  const graph = createPlanConfirmationGraph({ repository, ...scope });
  assert.deepEqual(await decidePlan(graph, { decision: 'REVISE', versionNumber: 2 }),
    { phase: 'AWAITING_REVISION', versionNumber: 2 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await decidePlan(graph, { decision: 'CONFIRM', versionNumber: 2 }),
    { phase: 'SOP_LOCKED', versionNumber: 2 });
  assert.deepEqual(calls[1], ['confirm', 'session', 'chat', 'case', 2]);
  await assert.rejects(decidePlan(graph, { decision: 'maybe', versionNumber: 2 }), TypeError);
  await assert.rejects(stagePlanProposal(repository, { ...scope, proposal: { ...proposal, scenarios: [] } }),
    { code: 'INVALID_PLAN' });
  assert.equal(calls.length, 2);
});
