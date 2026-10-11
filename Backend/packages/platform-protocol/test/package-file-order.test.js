import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePackageFileOrder} from '../src/consolidate-exchange-plan.js';
const send=(stepId,fileType,roundId='r1',value='20261011',dependsOn=[])=>({stepId,fileType,roundId,direction:'SEND',businessTime:{kind:'DATE',value},required:true,dependsOn});
test('only explicit same-package opening-to-trade file order compiles into OFI order',()=>{
 const steps=[send('open','01'),send('trade','03','r1','20261011',[{stepId:'open',condition:'SENT'}])];
 const plan={status:'READY',openQuestions:[],steps};assert.deepEqual(compilePackageFileOrder(plan).steps[1].dependsOn,[]);assert.equal(plan.steps[1].dependsOn.length,1);
 for(const changed of [{roundId:'r2'},{businessTime:{kind:'DATE',value:'20261012'}},{businessTime:{kind:'RELATIVE',value:'次日'}}]){
  const separate={...plan,steps:[steps[0],{...steps[1],...changed}]};assert.deepEqual(compilePackageFileOrder(separate).steps[1].dependsOn,steps[1].dependsOn);
 }
 const receipt={...steps[0],direction:'RECEIVE',fileType:'02'};
 assert.equal(compilePackageFileOrder({...plan,steps:[receipt,{...steps[1],dependsOn:[{stepId:'open',condition:'CONFIRMED'}]}]}).steps[1].dependsOn.length,1);
});
