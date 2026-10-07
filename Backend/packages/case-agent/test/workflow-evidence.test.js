import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowEvidence} from '../src/workflow-evidence.js';
const step=(stepId,fileType,direction,required=true)=>({stepId,fileType,direction,required});
const base={chatStatus:'ACTIVE',caseStatus:'SOP_LOCKED',plan:{version:4,status:'LOCKED',proposal:{exchangePlan:{status:'READY'}}},order:{version:4,plan:{steps:[step('send','03','SEND'),step('receive','04','RECEIVE'),step('optional','05','RECEIVE',false)]},events:[]},review:null};
test('terminal status alone never proves exchange, evaluation or manual confirmation',()=>{
 const facts={chatStatus:'CLOSED',caseStatus:'DISCUSSING',plan:null,order:null,review:null};
 assert.deepEqual(workflowEvidence(facts).completedStages,[]);
 assert.deepEqual(workflowEvidence({...facts,caseStatus:'PASS'}).completedStages,[]);
 assert.deepEqual(workflowEvidence({...base,caseStatus:'PASS'}).completedStages,['DEFINE_EXCHANGE_ORDER']);
});
test('real send and applied receipt prove required exchange; parse alone and optional omissions do not fabricate execution',()=>{
 const partial={...base,order:{...base.order,events:[{stepId:'send',condition:'SENT'},{stepId:'receive',condition:'PARSED'}]}};
 assert.deepEqual(workflowEvidence(partial).partialStages,['FILE_EXCHANGE']);
 assert.equal(workflowEvidence(partial).completedStages.includes('FILE_EXCHANGE'),false);
 const complete={...partial,order:{...partial.order,events:[...partial.order.events,{stepId:'receive',condition:'APPLIED'}]}};
 assert.equal(workflowEvidence(complete).completedStages.includes('FILE_EXCHANGE'),true);
 assert.equal(workflowEvidence(complete).exchangeSteps.find(s=>s.stepId==='optional').completed,false);
});
test('current-version reviewed and confirmed records remain proven after final or forced close; stale or inconsistent records do not',()=>{
 const review={planVersion:4,finalVerdict:'FAIL',confirmedAt:'2026-10-07'};
 const final={...base,chatStatus:'CLOSED',caseStatus:'FAIL',review};
 assert.deepEqual(workflowEvidence(final).completedStages,['DEFINE_EXCHANGE_ORDER','EVALUATE_RESULT','CONFIRM_RESULT']);
 assert.equal(workflowEvidence({...final,caseStatus:'PASS'}).result.confirmed,false);
 assert.equal(workflowEvidence({...final,review:{...review,confirmedAt:null}}).result.confirmed,false);
 assert.equal(workflowEvidence({...final,review:{...review,planVersion:3}}).result.evaluated,false);
 assert.equal(workflowEvidence({...base,review:{planVersion:4,evidenceCurrent:true}}).result.evaluated,true);
 assert.equal(workflowEvidence({...base,review:{planVersion:4,evidenceCurrent:false}}).result.evaluated,false);
});
test('no-file locked plan is not required, while unfinished or mismatched plans prove no skipped exchanges',()=>{
 const noFile={...base,order:null,plan:{...base.plan,proposal:{exchangePlan:{status:'NOT_REQUIRED'}}}};
 assert.deepEqual(workflowEvidence(noFile).notRequiredStages,['DEFINE_EXCHANGE_ORDER','FILE_EXCHANGE']);
 assert.deepEqual(workflowEvidence({...noFile,plan:{...noFile.plan,status:'PENDING_CONFIRMATION'}}).notRequiredStages,[]);
 assert.deepEqual(workflowEvidence({...base,order:{...base.order,version:3}}).completedStages,[]);
});
