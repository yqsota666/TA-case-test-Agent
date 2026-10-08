import test from 'node:test';
import assert from 'node:assert/strict';
import {revisePreparedPlanData} from '../src/prepared-plan-data.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
import {operationPlan} from '../../case-agent/test/operation-chain-fixture.js';
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
test('task edits persist in a new unconfirmed proposal and reject broken dependencies',async()=>{
  const proposal=operationPlan();let saved;
  const repository={getLatestSopProposal:async()=>({versionNumber:4,status:'PENDING_CONFIRMATION',proposal}),saveSopProposal:async(...args)=>{saved=args[3];}};
  const applications=structuredClone(proposal.contract.applications);applications[2].fields.ApplicationAmount='200.00';
  await call(repository,{versionNumber:4,dataSpecification:proposal.contract.dataSpecification,applications});
  assert.equal(saved.contract.applications[2].fields.ApplicationAmount,'200.00');
  assert.equal(proposal.contract.applications[2].fields.ApplicationAmount,'100.00');
  applications[2].dependsOn=[];saved=null;
  await assert.rejects(call(repository,{versionNumber:4,dataSpecification:proposal.contract.dataSpecification,applications}),{code:'DATA_EDIT_INVALID'});
  assert.equal(saved,null);
});
