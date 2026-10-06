import test from 'node:test';
import assert from 'node:assert/strict';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';
import {definePlanContract} from '../src/plan-contract.js';
import {compareConfirmedExpectations,createCaseResultGraph} from '../src/case-result-graph.js';
import {planContract} from './plan-contract-fixture.js';
import {exchangePlan} from './exchange-plan-fixture.js';
const plan={scenarios:[{expected:'确认成功，CONFIRMED'}],exchangePlan};
const contract=planContract(plan);
test('strict Plan validates linked drafts, typed expectations and fixed application amounts before confirmation',async()=>{
 assert.equal(validPlanContract(contract,plan),true);
 for(const mutate of [c=>c.expectations[0].selector.accountIndex=9,c=>c.expectations[0].source='constructor',c=>c.expectations[0].selector.businessDate='20260230',c=>c.expectations[0].field='invented',c=>c.expectations=[],c=>c.applications[0].fields.TAAccountID='invented',c=>c.dataSpecification.accounts.push({customerIndex:9,branchCode:'306'})]){
  const c=structuredClone(contract);mutate(c);assert.equal(validPlanContract(c,plan),false);
 }
 const calls=[];
 const result=await definePlanContract(async input=>{calls.push(input);if(calls.length===1)return JSON.stringify(contract.dataSpecification);const {version,protocolVersion,dataSpecification,...derived}=contract;return JSON.stringify(derived);},plan);
 assert.deepEqual(result.contract,contract);assert.equal(calls.length,2);
 await assert.rejects(definePlanContract(async()=>'{invalid',plan),{code:'DATA_SPEC_INVALID'});
});
test('confirmed typed expectations match the exact account/round; ambiguity, missing and wrong outcomes never pass',async()=>{
 const snapshot={plan:{...plan,contract},preparedAccounts:[{transactionAccountId:'90000000000000001'}],evidence:[{id:'app:1',source:{kind:'APPLICATION_CONFIRMATION',channelId:'7',fileType:'03',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',status:'CONFIRMED'}}],pending:[],issues:[]};
 assert.equal(compareConfirmedExpectations(snapshot).outcome,'PASS');
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not reinterpret confirmed assertions');}});
 assert.equal((await graph.invoke({})).suggestion.outcome,'PASS');
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[]}).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[...snapshot.evidence,...snapshot.evidence]}).outcome,'REVIEW');
 const wrong=structuredClone(snapshot);wrong.evidence[0].values.status='FAILED';assert.equal(compareConfirmedExpectations(wrong).outcome,'FAIL');
 wrong.evidence[0].source.businessDate='20261007';assert.equal(compareConfirmedExpectations(wrong).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations({...snapshot,pending:['04未完成']}).outcome,'WAITING');
});
