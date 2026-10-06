import test from 'node:test';
import assert from 'node:assert/strict';
import {readPredecessorContext} from '../src/predecessor-context.js';

test('predecessor context remains within 80000 bytes when accepted plan scalar fields are large',async()=>{
 const text='测'.repeat(1000);
 const proposal={objective:text,preconditions:Array(20).fill(text),openQuestions:Array(20).fill(text),scenarios:Array.from({length:10},()=>({title:text,setup:text,action:text,expected:text,evidence:text}))};
 const results=[{public_id:'source',title:'source',status:'FAIL'},{version_number:1,plan_json:proposal},{reviewId:'1',evidence_sha256:'a'.repeat(64),evidence_json:{evidence:[]},suggestion_json:{outcome:'FAIL'},confirmation_reason:'明确失败'}];
 const context=await readPredecessorContext({execute:async()=>[[results.shift()]]},[1,2],3);
 assert.ok(Buffer.byteLength(JSON.stringify(context))<=80000);
 assert.equal(context.truncated,true);assert.equal(context.originalPlan,null);
 assert.equal(context.casePublicId,'source');assert.equal(context.reviewId,'1');assert.equal(context.humanFailureReason,'明确失败');assert.equal(context.contextIsReadOnly,true);
});


test('predecessor byte bound includes the final truncated marker at the size boundary',async()=>{
 const proposal={objective:'',scenarios:Array.from({length:11},()=>({title:'scenario',expected:'result'}))};
 async function read(){
  const rows=[{public_id:'source',title:'source',status:'FAIL'},{version_number:1,plan_json:proposal},{reviewId:'1',evidence_sha256:'a'.repeat(64),evidence_json:{evidence:[]},suggestion_json:{outcome:'FAIL'},confirmation_reason:'failure'}];
  return readPredecessorContext({execute:async()=>[[rows.shift()]]},[1,2],3);
 }
 const baseline=await read();delete baseline.truncated;
 proposal.objective='a'.repeat(79990-Buffer.byteLength(JSON.stringify(baseline)));
 const result=await read();assert.equal(result.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<=80000);
});
