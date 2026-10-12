import assert from 'node:assert/strict';
import test from 'node:test';
import {showExchangeEntry} from './exchange-entry.js';
const plan={status:'LOCKED',proposal:{contract:{version:4},exchangePlan:{status:'READY'}}};
test('prepared file arrangements do not expose exchange before both explicit confirmations',()=>{
  assert.equal(showExchangeEntry({...plan,status:'DRAFT'},{reviewStatus:'CONFIRMED'}),false);
  assert.equal(showExchangeEntry({...plan,status:'REVIEWABLE'},{reviewStatus:'CONFIRMED'}),false);
  assert.equal(showExchangeEntry(plan,{reviewStatus:'PENDING'}),false);
  assert.equal(showExchangeEntry(plan,null),false);
  assert.equal(showExchangeEntry(null,{reviewStatus:'CONFIRMED'}),false);
});
test('confirmed file workflows retain an entry, while no-file plans do not',()=>{
  assert.equal(showExchangeEntry(plan,{reviewStatus:'CONFIRMED'}),true);
  assert.equal(showExchangeEntry({...plan,proposal:{...plan.proposal,exchangePlan:{status:'NOT_REQUIRED'}}},{reviewStatus:'CONFIRMED'}),false);
  assert.equal(showExchangeEntry({...plan,proposal:{exchangePlan:{status:'READY'}}},{reviewStatus:'CONFIRMED'}),false);
});
