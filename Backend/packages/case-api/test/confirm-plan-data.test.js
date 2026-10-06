import assert from 'node:assert/strict';
import test from 'node:test';
import {createConfirmPlanWithData} from '../src/confirm-plan-data.js';
const input={token:'session',chatPublicId:'chat',casePublicId:'case',versionNumber:2};
const specification={customers:[],accounts:[],funds:[],holdings:[],missing:[]};
const pending={status:'PENDING_CONFIRMATION',versionNumber:2,proposal:{contract:{dataSpecification:specification}}};
test('data confirmation does not derive, lock or execute before expectation confirmation',async()=>{
 const calls=[];
 const service=createConfirmPlanWithData({repository:{getLatestSopProposal:async()=>pending},
  confirm:async a=>{calls.push(a.section);return {phase:'AWAITING_EXPECTATIONS'};},
  executeData:async()=>{throw new Error('must not execute');}});
 assert.equal((await service({...input,section:'DATA'})).phase,'AWAITING_EXPECTATIONS');
 assert.deepEqual(calls,['DATA']);
});
test('expectation confirmation executes the previously displayed data without calling a model',async()=>{
 const calls=[];
 const service=createConfirmPlanWithData({repository:{getLatestSopProposal:async()=>pending},confirm:async()=>calls.push('confirm'),executeData:async a=>{assert.equal(a.specification,specification);calls.push('execute');return {reviewStatus:'PENDING_REVIEW'};}});
 assert.equal((await service({...input,section:'EXPECTATIONS'})).phase,'DATA_REVIEW');
 assert.deepEqual(calls,['confirm','execute']);
});
test('locked Plan execution retry reuses identical data; legacy pending Plan cannot be newly confirmed',async()=>{
 let status='PENDING_CONFIRMATION',attempts=0,confirmations=0;
 const service=createConfirmPlanWithData({repository:{getLatestSopProposal:async()=>({...pending,status})},confirm:async()=>{status='LOCKED';confirmations++;},executeData:async a=>{assert.equal(a.specification,specification);if(++attempts===1)throw new Error('temporary database failure');return {reviewStatus:'PENDING_REVIEW'};}});
 await assert.rejects(service({...input,section:'EXPECTATIONS'}),/temporary database failure/);
 assert.equal((await service({...input,section:'EXPECTATIONS'})).phase,'DATA_REVIEW');
 assert.equal(confirmations,1);
 const legacy=createConfirmPlanWithData({repository:{getLatestSopProposal:async()=>({...pending,proposal:{}})}});
 await assert.rejects(legacy({...input,section:'DATA'}),{code:'PLAN_CONTRACT_REQUIRED'});
 await assert.rejects(service({...input,section:'UNKNOWN'}),{code:'PLAN_SECTION_REQUIRED'});
});
