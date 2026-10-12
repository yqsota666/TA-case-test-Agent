import test from 'node:test';
import assert from 'node:assert/strict';
import {planApproval} from '../src/plan-approval.js';
test('one plan advances through two explicit approvals and never exposes approval for incomplete content',()=>{
  assert.equal(planApproval({status:'DRAFT'},{}).section,undefined);
  assert.equal(planApproval({status:'PENDING_CONFIRMATION',confirmations:[]},{}).section,'DATA');
  assert.equal(planApproval({status:'PENDING_CONFIRMATION',confirmations:[{section:'DATA'}]},{}).section,'EXPECTATIONS');
  assert.equal(planApproval({status:'LOCKED'},{stage:'FILE_EXCHANGE'}).section,undefined);
});
test('failed data preparation can retry; historical generated-data review keeps its original semantics',()=>{
  assert.equal(planApproval({status:'LOCKED'},{stage:'PREPARE_DATA'}).section,'RETRY_DATA');
  assert.equal(planApproval({status:'LOCKED',dataApprovalMode:'PLAN_CONFIRMED'},{stage:'CONFIRM_DRAFT'}).section,'RETRY_DATA');
  assert.equal(planApproval({status:'LOCKED'},{stage:'CONFIRM_DRAFT'}).section,undefined);
});
