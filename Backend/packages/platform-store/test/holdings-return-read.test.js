import test from 'node:test';
import assert from 'node:assert/strict';
import {createHoldingsReturnRepository} from '../src/holdings-return.js';
const scope={chatPublicId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',casePublicId:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'};
function fixture({owned=true,locked=true}={}){
 const queries=[];const db={execute:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('FROM platform_sessions'))return [[{user_id:2,workspace_id:7}]];
  if(sql.includes('FROM case_chats'))return [owned?[{chat_id:11,case_id:13,chat_status:'ACTIVE',case_status:'SOP_LOCKED'}]:[]];
  if(sql.includes('FROM case_holdings_return_parses'))return [[{parseId:'3',channelId:'5',parsed:JSON.stringify({files:[]}),applied:null}]];
  if(sql.includes('FROM case_sop_versions'))return [locked?[{version_number:2,plan_json:JSON.stringify({exchangePlan:{status:'READY',steps:[{stepId:'balance',direction:'RECEIVE',fileType:'05'},{stepId:'buy',direction:'RECEIVE',fileType:'04'}]}})}]:[]];
  if(sql.includes('plan_version AS planVersion'))return [[{parseId:'3',planVersion:1,stepId:'old-balance'},{parseId:'3',planVersion:2,stepId:'balance'},{parseId:'4',planVersion:2,stepId:'other'}]];
  return [[]];
 }};return {repository:createHoldingsReturnRepository({transaction:fn=>fn(db)}),queries};
}
test('05 history includes real receipt bindings and the current locked Plan version',async()=>{
 const {repository,queries}=fixture();const result=await repository.read('a'.repeat(43),scope);
 assert.equal(result.planVersion,2);assert.deepEqual(result.steps.map(step=>step.stepId),['balance']);
 assert.deepEqual(result.parses[0].receipts.map(receipt=>receipt.stepId),['old-balance','balance']);
 const query=queries.find(query=>query.sql.includes('plan_version AS planVersion'));assert.deepEqual(query.params,[7,11,13]);
 assert.match(query.sql,/workspace_id=\? AND chat_id=\? AND case_id=\?/);
});
test('unlocked Plan exposes no ready05 step while retaining scoped historical parsing',async()=>{
 const {repository}=fixture({locked:false});const result=await repository.read('a'.repeat(43),scope);
 assert.deepEqual(result.steps,[]);assert.equal(result.planVersion,null);assert.equal(result.planningError.error,'EXCHANGE_PLAN_REQUIRED');
});
test('foreign Case stops before reading05 history or bindings',async()=>{
 const {repository,queries}=fixture({owned:false});await assert.rejects(()=>repository.read('a'.repeat(43),scope),{code:'CASE_NOT_FOUND'});
 assert.equal(queries.some(query=>query.sql.includes('FROM case_holdings_return_parses')),false);
});
