import test from 'node:test';
import assert from 'node:assert/strict';
import {diagramStates} from './workflow-diagram-model.js';
const at=(stage,extra={})=>diagramStates({workflow:{stage,...extra}});
test('six customer steps map internal preparation stages without extra approvals in the timeline',()=>{
 assert.equal(at('DISCUSSION').length,6);
 for(const stage of ['PREPARE_DATA','CONFIRM_DRAFT','DEFINE_EXCHANGE_ORDER'])assert.equal(at(stage)[3].status,'current');
 assert.deepEqual(at('CONFIRM_PLAN_DATA').map(n=>n.status),['done','current','pending','pending','pending','pending']);
});
test('draft and file-order confirmation do not prove ZIP generation',()=>{
 assert.equal(at('FILE_EXCHANGE',{tasks:[{state:'READY'}]})[3].status,'current');
 assert.equal(at('FILE_EXCHANGE',{tasks:[{state:'GENERATED'},{state:'READY'}]})[3].status,'current');
 const nodes=at('FILE_EXCHANGE',{tasks:[{state:'GENERATED'},{state:'GENERATED'}]});assert.equal(nodes[3].status,'done');assert.equal(nodes[4].status,'current');
});
test('result review and confirmation share a step; blockers stay visible',()=>{
 assert.equal(at('CONFIRM_RESULT')[5].status,'current');
 assert.equal(at('EVALUATE_RESULT',{blockers:[{}]})[4].status,'blocked');
});
test('no-file cases skip ZIP and TA exchange',()=>{
 const nodes=diagramStates({workflow:{stage:'EVALUATE_RESULT'},plan:{proposal:{exchangePlan:{status:'NOT_REQUIRED'}}}});
 assert.deepEqual(nodes.slice(3).map(n=>n.status),['skipped','skipped','current']);
});
test('closure and verdict never fabricate file generation or confirmed results',()=>{
 assert.ok(at('CHAT_CLOSED').every(n=>n.status==='unknown'));
 const partial=at('CHAT_CLOSED',{proven:{partialStages:['FILE_EXCHANGE'],completedStages:[]}});assert.equal(partial[4].status,'partial');assert.equal(partial[5].status,'unknown');
 const final=diagramStates({workflow:{stage:'CASE_FINAL',proven:{completedStages:['FILE_EXCHANGE','CONFIRM_RESULT']}},caseStatus:'FAIL'});assert.deepEqual(final.slice(3).map(n=>n.status),['done','done','done']);
});
test('missing state and returning to discussion never invent progress',()=>{
 assert.ok(diagramStates({}).every(n=>n.status==='pending'));
 assert.equal(at('DISCUSSION')[3].status,'pending');
});

test('multi-submission history shows partial preparation while waiting on a real return',()=>{
 const nodes=at('FILE_EXCHANGE',{proven:{exchangeSteps:[{fileType:'01',completed:true},{fileType:'03',completed:false}]}});
 assert.equal(nodes[3].status,'partial');assert.equal(nodes[4].status,'current');
});
