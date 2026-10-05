import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { migrationStatements } from '../src/migrate.js';

test('the SOP widening migration is accepted as one recoverable DDL step', () => {
  const sql = fs.readFileSync(new URL('../migrations/003_sop_status_width.sql', import.meta.url), 'utf8');
  const steps = migrationStatements(sql);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, 'WIDEN_SOP_STATUS');
  assert.equal(steps[0].table, 'case_sop_versions');
  assert.match(steps[0].sql, /DROP CHECK ck_sop_lock/);
  assert.match(steps[0].sql, /ADD CONSTRAINT ck_sop_lock/);
});

test('the discussion history migration creates one scoped table with pending and complete states', () => {
  const sql = fs.readFileSync(new URL('../migrations/004_case_discussion_turns.sql', import.meta.url), 'utf8');
  const steps = migrationStatements(sql);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, 'CREATE');
  assert.equal(steps[0].table, 'case_discussion_turns');
  assert.match(steps[0].sql, /fk_discussion_case/);
  assert.match(steps[0].sql, /status='PENDING'/);
});

test('the proposal linkage migration adds a turn kind and a scoped SOP source', () => {
  const sql = fs.readFileSync(new URL('../migrations/005_discussion_turn_kind.sql', import.meta.url), 'utf8');
  const steps = migrationStatements(sql);
  assert.deepEqual(steps.map(step => step.kind), ['ADD_TURN_KIND', 'ADD_SOP_SOURCE', 'WIDEN_REPLY']);
  assert.match(steps[1].sql, /FOREIGN KEY \(workspace_id,chat_id,case_id,source_turn_number\)/);
});
