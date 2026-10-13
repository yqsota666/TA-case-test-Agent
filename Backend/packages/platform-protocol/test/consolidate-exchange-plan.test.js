import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateExchangePlan} from '../src/consolidate-exchange-plan.js';
import {validExchangePlan} from '../src/exchange-plan.js';
const make=(count,dates)=>({status:'READY',openQuestions:[],steps:Array.from({length:count},(_,i)=>[
 {stepId:`o${i}`,roundId:`open${i}`,direction:'SEND',fileType:'01',required:true,businessTime:{kind:'DATE',value:'20261006'},dependsOn:[]},
 {stepId:`r${i}`,roundId:`open${i}`,direction:'RECEIVE',fileType:'02',required:true,businessTime:{kind:'DATE',value:'20261006'},dependsOn:[{stepId:`o${i}`,condition:'SENT'}]},
 {stepId:`s${i}`,roundId:`sub${i}`,direction:'SEND',fileType:'03',required:true,businessTime:{kind:'DATE',value:dates?.[i]??'20261007'},dependsOn:[{stepId:`r${i}`,condition:'CONFIRMED'}]},
 {stepId:`c${i}`,roundId:`sub${i}`,direction:'RECEIVE',fileType:'04',required:true,businessTime:{kind:'DATE',value:dates?.[i]??'20261007'},dependsOn:[{stepId:`s${i}`,condition:'SENT'}]}
]).flat()});
test('equivalent independent customer rounds become four real exchange steps',()=>{
 for(const n of [2,3,8]) {
  const original=make(n),result=consolidateExchangePlan(original);
  assert.equal(validExchangePlan(result),true);assert.equal(result.steps.length,4);
  assert.deepEqual(result.steps[2].dependsOn,[{stepId:'r0',condition:'CONFIRMED'}]);
  assert.equal(original.steps.length,n*4);assert.deepEqual(consolidateExchangePlan(result),result);
 }
});
test('different send dates or confirmation gates do not pretend to be one batch',()=>{
 const dated=consolidateExchangePlan(make(2,['20261007','20261008']));
 assert.equal(dated.steps.length,6);assert.equal(validExchangePlan(dated),true);
 const p=make(2);p.steps[4].dependsOn=[{stepId:'c0',condition:'CONFIRMED'}];
 assert.equal(consolidateExchangePlan(p).steps.length,8);
 const receive=make(2);receive.steps[5].businessTime.value='20261007';
 assert.equal(consolidateExchangePlan(receive).steps.length,8);
});
