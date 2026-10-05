import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseRepository } from '../src/index.js';

const token = 'a'.repeat(43);
const chatId = '9b039fda-601d-4f3c-b065-0f7bf0837ccc';
const caseId = '15d68e0b-6ae6-4ced-9ad8-9b705c4744ef';
const changes = () => ({ customers: [], accounts: [], funds: [], holdings: [] });

function fixture() {
  const calls = [];
  const state = { caseStatus: 'SOP_LOCKED', execution: null, revision: 0,
    confirmation: null, turns: [], accounts: [], customers: [{ id: 81, name: '模拟客户' }] };
  const db = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM platform_sessions')) return [[{ user_id: 7, workspace_id: 31 }]];
    if (sql.includes('FROM case_chats')) return [[{ id: 41, status: 'ACTIVE' }]];
    if (sql.includes('FROM cases')) return [[{ id: 51, status: state.caseStatus }]];
    if (sql.includes('FROM case_sop_versions')) return [[{ id: 61 }]];
    if (sql.includes('FROM case_data_executions')) return [[state.execution]];
    if (sql.includes('FROM case_generated_customers')) {
      return sql.includes('AND id=?') ? [[state.customers.find(row => row.id === Number(values.at(-1)))]]
        : [state.customers];
    }
    if (sql.includes('FROM case_generated_accounts')) return [state.accounts];
    if (sql.includes('FROM case_generated_funds') || sql.includes('FROM case_generated_holdings')) return [[]];
    if (sql.includes('FROM case_data_edit_events')) return [[{ revision: state.revision }]];
    if (sql.includes('FROM case_data_confirmations')) return [[state.confirmation]];
    if (sql.includes('FROM case_data_review_turns')) return [[{ number: state.turns.length }]];
    if (sql.includes('INSERT INTO case_data_executions')) state.execution = { sop_version_id: 61 };
    if (sql.includes('INSERT INTO case_generated_accounts')) {
      state.accounts.push({ id: 91, customer_id: Number(values[3]), branch_code: values[5] });
    }
    if (sql.includes('INSERT INTO case_data_edit_events')) state.revision = values[3];
    if (sql.includes('INSERT INTO case_data_review_turns')) state.turns.push(values);
    if (sql.includes('INSERT INTO case_data_confirmations')) state.confirmation = { revision: values[3] };
    if (sql.includes("UPDATE cases SET status='EXECUTING'")) state.caseStatus = 'EXECUTING';
    return [{ affectedRows: 1, insertId: 91 }];
  } };
  return { calls, state, repository: createCaseRepository({ transaction: action => action(db) }) };
}

test('generation stays pending; empty AI answer preserves revision; account edit and latest confirmation gate writes', async () => {
  const { repository, calls, state } = fixture();
  const args = [token, chatId, caseId];
  const generated = await repository.executeGeneratedData(...args, 1, { customers: [] },
    async () => ({ validated: true }));
  assert.equal(generated.reviewStatus, 'PENDING_REVIEW');
  assert.equal(state.caseStatus, 'SOP_LOCKED');
  const asked = await repository.editGeneratedData(...args, { revision: 0, changes: changes() },
    { userInput: '这批数据有几个账户？', reply: '目前没有账户。' });
  assert.equal(asked.revision, 0);
  assert.equal(state.turns.length, 1);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO case_data_edit_events')), false);
  const edit = changes();
  edit.accounts.push({ id: null, customerId: '81', branchCode: '305' });
  const updated = await repository.editGeneratedData(...args, { revision: 0, changes: edit });
  assert.equal(updated.revision, 1);
  assert.equal(state.accounts.length, 1);
  await assert.rejects(repository.confirmGeneratedData(...args, 0), { code: 'DATA_EDIT_CONFLICT' });
  const confirmed = await repository.confirmGeneratedData(...args, 1);
  assert.equal(confirmed.reviewStatus, 'CONFIRMED');
  assert.equal(state.caseStatus, 'EXECUTING');
  await assert.rejects(repository.editGeneratedData(...args, { revision: 1, changes: edit }),
    { code: 'DATA_ALREADY_CONFIRMED' });
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO case_data_confirmations')).length, 1);
});
