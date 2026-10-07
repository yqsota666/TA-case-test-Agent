import test from 'node:test';
import assert from 'node:assert/strict';
import {dataExchangeRequirementIssues} from '../src/data-exchange-requirements.js';
const plan=(accounts=2,funds=1)=>({exchangePlan:{status:'NOT_REQUIRED',steps:[]},contract:{dataSpecification:{accounts:Array.from({length:accounts},()=>({})),funds:Array.from({length:funds},()=>({})),holdings:[]},applications:[]}});
function complete(p){
 for(const [type,returned] of [['01','02'],['03','04']]){
 p.exchangePlan.steps.push({stepId:type,roundId:type,direction:'SEND',fileType:type,required:true,dependsOn:type==='03'?[{stepId:'02',condition:'CONFIRMED'}]:[]},{stepId:returned,roundId:type,direction:'RECEIVE',fileType:returned,required:true,dependsOn:[{stepId:type,condition:'SENT'}]});
 p.contract.applications.push(...p.contract.dataSpecification.accounts.map((_,accountIndex)=>({stepId:type,accountIndex})));
 }
 return p;
}
test('synthetic resources cannot silently opt out of TA exchange',()=>{
 for(const n of [1,3,8])assert.equal(dataExchangeRequirementIssues(plan(n)).length,2);
});
test('complete resource construction does not require 05',()=>assert.deepEqual(dataExchangeRequirementIssues(complete(plan())),[]));
test('having file names without return paths or complete account coverage is insufficient',()=>{
 const p=complete(plan());p.exchangePlan.steps=p.exchangePlan.steps.filter(s=>s.fileType!=='02');p.contract.applications=p.contract.applications.filter(a=>a.stepId!=='03'||a.accountIndex===0);
 assert.match(dataExchangeRequirementIssues(p).join('；'),/02/);assert.match(dataExchangeRequirementIssues(p).join('；'),/覆盖/);
});
test('read-only formal resources and account-only creation retain distinct routes',()=>{
 assert.deepEqual(dataExchangeRequirementIssues(plan(0)),[]);assert.equal(dataExchangeRequirementIssues(plan(1,0)).length,1);
});

test('new account subscriptions must wait for their own successful opening return',()=>{
 const p=complete(plan());p.exchangePlan.steps.find(s=>s.fileType==='03').dependsOn=[];
 assert.match(dataExchangeRequirementIssues(p).join('；'),/等待对应02/);
});

test('omitting account drafts does not turn new synthetic customers into a read-only case',()=>{
 const p=plan(0);p.contract.dataSpecification.customers=[{name:'合成客户'}];
 assert.match(dataExchangeRequirementIssues(p).join('；'),/01/);assert.match(dataExchangeRequirementIssues(p).join('；'),/03/);
});

test('fund holdings require a matching account and fund application reference',()=>{
 const p=complete(plan());p.contract.dataSpecification.holdings=[{accountIndex:1,fundIndex:0}];
 assert.match(dataExchangeRequirementIssues(p).join('；'),/基金持仓/);
 p.contract.applications.find(a=>a.stepId==='03'&&a.accountIndex===1).fundIndex=0;
 assert.deepEqual(dataExchangeRequirementIssues(p),[]);
});
