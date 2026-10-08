import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleView,lifecycleCommand,caseStatusLabel} from './project-lifecycle.js';
const snapshot={chat:{status:'ACTIVE'},canClose:false,cases:[{publicId:'a',status:'FAIL',finalVerdict:'FAIL'},{publicId:'b',status:'PASS',finalVerdict:'PASS'}]};
test('only human-final failure without a successor can create linked retest',()=>{
 assert.equal(lifecycleView(snapshot,'a').canRetest,true);
 assert.equal(lifecycleView(snapshot,'b').canRetest,false);
 assert.equal(lifecycleView({...snapshot,cases:[{publicId:'a',status:'FAIL'}]},'a').canRetest,false);
 const linked={...snapshot,cases:[...snapshot.cases,{publicId:'c',status:'DISCUSSING',predecessorCasePublicId:'a'}]};
 assert.equal(lifecycleView(linked,'a').canRetest,false);assert.equal(lifecycleView(linked,'a').successor.publicId,'c');
});
test('server close eligibility governs UI, no client inference from all pass',()=>{
 assert.equal(lifecycleView({...snapshot,cases:[snapshot.cases[1]]},'b').canClose,false);
 assert.equal(lifecycleView({...snapshot,canClose:true},'b').canClose,true);
 for(const status of ['CLOSED','FORCE_CLOSED']){const view=lifecycleView({...snapshot,chat:{status},canClose:true},'a');assert.equal(view.canClose,false);assert.equal(view.canRetest,false);assert.equal(view.sealed,true);}
});
test('lifecycle commands contain only exact real API fields and no inherited plan/data',()=>{
 const input={caseId:'a',reason:' 修正后重新讨论 ',preserve:true};
 assert.deepEqual(lifecycleCommand('normal',input,'id'),{route:'close',body:{mode:'NORMAL'}});
 assert.deepEqual(lifecycleCommand('force',input,'id'),{route:'close',body:{mode:'FORCE',reason:'修正后重新讨论'}});
 assert.deepEqual(lifecycleCommand('retest',input,'id'),{route:'retest',body:{requestId:'id',casePublicId:'a',reason:'修正后重新讨论'}});
 assert.deepEqual(lifecycleCommand('new-run',input,'id'),{route:'new-run',body:{requestId:'id',reason:'修正后重新讨论',confirmPreserveFormalData:true}});
});
test('forced closure and new run require actual reason and preservation consent',()=>{
 for(const kind of ['force','retest','new-run'])assert.throws(()=>lifecycleCommand(kind,{reason:'  '},'id'));
 assert.throws(()=>lifecycleCommand('new-run',{reason:'继续'},'id'));
 assert.throws(()=>lifecycleCommand('force',{reason:'x'.repeat(2001)},'id'));
 assert.equal(caseStatusLabel({status:'PASS'}),'未完成');assert.equal(caseStatusLabel({finalVerdict:'PASS'}),'已通过');
});
