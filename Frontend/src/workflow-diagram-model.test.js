import test from 'node:test';
import assert from 'node:assert/strict';
import {diagramStates} from './workflow-diagram-model.js';
test('pending Plan only completes discussion, not data generation',()=>{
 const nodes=diagramStates({workflow:{stage:'CONFIRM_PLAN_DATA'}});
 assert.deepEqual(nodes.slice(0,5).map(n=>n.status),['done','done','current','pending','pending']);
});
test('revised Plan returns to discussion without retaining apparent success',()=>{
 const nodes=diagramStates({workflow:{stage:'DISCUSSION'},data:{status:'GENERATED'}});
 assert.equal(nodes[4].status,'pending');
});
test('blocked exchange is not drawn as successful after result routing',()=>{
 const nodes=diagramStates({workflow:{stage:'EVALUATE_RESULT',blockers:[{}]}});
 assert.equal(nodes[7].status,'blocked'); assert.equal(nodes[8].status,'current');
});
test('force-closed project does not imply completed workflow',()=>{
 const nodes=diagramStates({workflow:{stage:'CHAT_CLOSED'},caseStatus:'DISCUSSING'});
 assert.equal(nodes[1].status,'unknown'); assert.equal(nodes[10].status,'unknown'); assert.equal(nodes[11].status,'current');
});
test('missing workflow never reports a current node',()=>{
 assert.equal(diagramStates({}).some(n=>n.status==='current'),false);
});

test('no-file Plan does not report file nodes as executed',()=>{
 const nodes=diagramStates({workflow:{stage:'EVALUATE_RESULT'},plan:{proposal:{exchangePlan:{status:'NOT_REQUIRED'}}}});
 assert.equal(nodes[6].status,'skipped');assert.equal(nodes[7].status,'skipped');assert.equal(nodes[8].status,'current');
});

test('final verdict paints only recorded completion evidence',()=>{
 const nodes=diagramStates({workflow:{stage:'CASE_FINAL',proven:{version:1,completedStages:['DEFINE_EXCHANGE_ORDER','FILE_EXCHANGE','EVALUATE_RESULT','CONFIRM_RESULT']}},caseStatus:'PASS'});
 assert.deepEqual(nodes.slice(6,10).map(n=>n.status),['done','done','done','done']);
 assert.equal(nodes[1].status,'unknown');assert.equal(nodes[11].status,'pending');
});
test('partial exchange and force-close cannot fabricate future completion',()=>{
 const nodes=diagramStates({workflow:{stage:'CHAT_CLOSED',proven:{version:1,completedStages:['DEFINE_EXCHANGE_ORDER'],partialStages:['FILE_EXCHANGE']}},caseStatus:'DISCUSSING'});
 assert.equal(nodes[7].status,'partial');assert.equal(nodes[8].status,'unknown');assert.equal(nodes[9].status,'unknown');
});
