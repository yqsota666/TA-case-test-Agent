import { planContract } from '../../case-agent/test/plan-contract-fixture.js';
import { exchangePlan } from '../../case-agent/test/exchange-plan-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseRepository } from '../src/index.js';

const token = 'a'.repeat(43);
const chatPublicId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const casePublicId = '15d68e0b-6ae6-4ced-9ad8-9b705c4744ef';
const plan = { objective: '检查规则', preconditions: [],
  scenarios: [{ title: '边界场景', setup: '准备边界数据', action: '执行操作',
    expected: '确认状态CONFIRMED，观察结果符合规则', evidence: '记录输入输出' }], openQuestions: [], exchangePlan };

function fixture({ chat = { id: 41, status: 'ACTIVE' }, caseRow = { id: 51, status: 'DISCUSSING' } } = {}) {
  const calls = [];
  const versions = [];
  const confirmations=[];
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_chats')) return [[chat]];
    if (sql.includes('FROM cases')) return [[caseRow]];
    if (sql.includes('FROM case_discussion_turns')) return [[undefined]];
    if (sql.includes('FROM case_plan_section_confirmations')) return [confirmations.filter(r=>r.version===values[3])];
    if (sql.includes('INSERT INTO case_plan_section_confirmations')) confirmations.push({version:values[3],section:values[4]});
    if (sql.includes('FROM case_sop_versions')) return [[versions.at(-1)]];
    if (sql.includes('INSERT INTO case_sop_versions')) {
      versions.push({ id: versions.length + 1, version_number: values[3],
        plan_json: values[4], status: 'PENDING_CONFIRMATION' });
    }
    if (sql.includes("SET status='DRAFT'")) versions.at(-1).status = 'DRAFT';
    if (sql.includes("SET status='LOCKED'")) versions.at(-1).status = 'LOCKED';
    if (sql.includes("SET status='SOP_PENDING'")) caseRow.status = 'SOP_PENDING';
    if (sql.includes("SET status='SOP_LOCKED'")) caseRow.status = 'SOP_LOCKED';
    return [{}];
  } };
  return { calls, versions, caseRow, repository: createCaseRepository({ transaction: action => action(db) }) };
}

test('proposal revisions invalidate old confirmations; latest approved version locks with a user event', async () => {
  const { repository, versions, caseRow, calls } = fixture();
  const args = [token, chatPublicId, casePublicId];
  const strictPlan={...plan,contract:planContract(plan)};
  assert.deepEqual(await repository.saveSopProposal(...args, strictPlan),
    { versionNumber: 1, status: 'PENDING_CONFIRMATION' });
  assert.deepEqual(await repository.saveSopProposal(...args, strictPlan),
    { versionNumber: 2, status: 'PENDING_CONFIRMATION' });
  assert.equal(versions[0].status, 'DRAFT');
  assert.equal((await repository.getLatestSopProposal(...args)).versionNumber, 2);
  await assert.rejects(repository.confirmSopProposal(...args, 1), { code: 'STALE_PLAN' });
  await assert.rejects(repository.confirmSopProposal(...args,2,'EXPECTATIONS'),{code:'PLAN_DATA_CONFIRMATION_REQUIRED'});
  assert.equal((await repository.confirmSopProposal(...args,2,'DATA')).phase,'AWAITING_EXPECTATIONS');
  assert.equal(caseRow.status,'SOP_PENDING');
  assert.deepEqual(await repository.confirmSopProposal(...args, 2,'EXPECTATIONS'),
    { versionNumber: 2, status: 'LOCKED',phase:'SOP_LOCKED' });
  assert.equal(caseRow.status, 'SOP_LOCKED');
  assert.equal(versions[1].status, 'LOCKED');
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO case_state_events')).length, 2);
  assert.ok(calls.some(call => call.sql.includes('USER_CONFIRMED_PLAN') && call.values.at(-1) === 7));
  await assert.rejects(repository.confirmSopProposal(...args, 2), { code: 'INVALID_CASE_STATE' });
});

test('confirmation rejects unresolved questions, closed chats, and cases outside the scoped Chat', async () => {
  const args = [token, chatPublicId, casePublicId];
  const unresolved = fixture();
  await unresolved.repository.saveSopProposal(...args, { ...plan, openQuestions: ['需确认什么'] });
  await assert.rejects(unresolved.repository.confirmSopProposal(...args, 1),
    { code: 'PLAN_HAS_OPEN_QUESTIONS' });
  assert.equal(unresolved.caseRow.status, 'SOP_PENDING');
  const closed = fixture({ chat: { id: 41, status: 'FORCE_CLOSED' } });
  await assert.rejects(closed.repository.saveSopProposal(...args, plan), { code: 'CHAT_CLOSED' });
  const foreign = fixture({ caseRow: null });
  await assert.rejects(foreign.repository.saveSopProposal(...args, plan), { code: 'CASE_NOT_FOUND' });
  assert.equal(foreign.calls.some(call => call.sql.includes('INSERT INTO case_sop_versions')), false);
});

test('repository refuses to save an incomplete Plan, including when called without the Agent wrapper', async () => {
  const { repository, calls } = fixture();
  await assert.rejects(repository.saveSopProposal(token, chatPublicId, casePublicId,
    { ...plan, scenarios: [{ title: '缺少执行细节' }] }), { code: 'INVALID_PLAN' });
  assert.equal(calls.length, 0);
});

test('repository rejects inline Markdown even when the Agent wrapper is bypassed', async () => {
  const { repository, calls } = fixture();
  for (const objective of ['检查*边界*规则', '检查_边界_规则', '检查[边界](https://example.com)规则']) {
    await assert.rejects(repository.saveSopProposal(token, chatPublicId, casePublicId,
      { ...plan, objective }), { code: 'INVALID_PLAN' });
  }
  assert.equal(calls.length, 0);
});

test('repository accepts plain identifier underscores without the Agent wrapper', async () => {
  const { repository } = fixture();
  assert.deepEqual(await repository.saveSopProposal(token, chatPublicId, casePublicId,
    { ...plan, objective: 'confirm_record_id' }),
  { versionNumber: 1, status: 'PENDING_CONFIRMATION' });
});

test('legacy or unresolved exchange plan remains readable but cannot be newly locked by guessing defaults',async()=>{
 for(const exchange of [undefined,{status:'UNPLANNED',steps:[],openQuestions:['是哪天？']}]){
  const f=fixture();const proposal={...plan};if(exchange)proposal.exchangePlan=exchange;else delete proposal.exchangePlan;
  await f.repository.saveSopProposal(token,chatPublicId,casePublicId,proposal);
  assert.equal((await f.repository.getLatestSopProposal(token,chatPublicId,casePublicId)).status,'PENDING_CONFIRMATION');
  await assert.rejects(f.repository.confirmSopProposal(token,chatPublicId,casePublicId,1),{code:'EXCHANGE_PLAN_REQUIRED'});
  assert.equal(f.versions[0].status,'PENDING_CONFIRMATION');
 }
});
