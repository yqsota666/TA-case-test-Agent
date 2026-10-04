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
