import test from 'node:test';
import assert from 'node:assert/strict';
import {revisePreparedPlanData} from '../src/prepared-plan-data.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
const proposal={scenarios:[{expected:'确认成功，CONFIRMED'}],exchangePlan};
proposal.contract=planContract(proposal);
const data=proposal.contract.dataSpecification;
const call=(repository,body)=>revisePreparedPlanData({repository,token:'local',chatPublicId:'chat',casePublicId:'case',body});
test('editing prepared data creates a new unconfirmed version with optimistic version guard',async()=>{
  const current={versionNumber:4,status:'PENDING_CONFIRMATION',proposal};let saved;
  const repository={getLatestSopProposal:async()=>current,saveSopProposal:async(...args)=>{saved=args;}};
  await call(repository,{versionNumber:4,dataSpecification:data});
  assert.deepEqual(saved.at(-1),{expectedVersion:4});assert.notEqual(saved[3],proposal);
});
test('stale and locked prepared plans cannot be edited',async()=>{
  for(const current of [{versionNumber:5,status:'PENDING_CONFIRMATION'},{versionNumber:4,status:'LOCKED'}]) {
    await assert.rejects(call({getLatestSopProposal:async()=>current},{versionNumber:4,dataSpecification:data}),{code:'STALE_PLAN'});
  }
});
test('invalid formats and customer references are rejected before saving',async()=>{
  await assert.rejects(call({}, {versionNumber:4,dataSpecification:{...data,customers:[{name:'Test',investorType:'1',simulatedBalance:'100'}]}}),{code:'DATA_EDIT_INVALID'});
  await assert.rejects(call({getLatestSopProposal:async()=>({versionNumber:4,status:'PENDING_CONFIRMATION',proposal})},{versionNumber:4,dataSpecification:{...data,accounts:[{customerIndex:99,branchCode:'0001'}]}}),{code:'DATA_EDIT_INVALID'});
});
