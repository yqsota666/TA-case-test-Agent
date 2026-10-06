import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeOrderContext,checkExchangeOrder,recordExchangeEvent} from '../src/exchange-order.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
const keys=[31,41,51];
function dbFixture({plan=exchangePlan,version=7,events=[]}={}) {
 const calls=[];
 const db={async execute(sql,values){calls.push({sql,values});
  if(sql.includes('FROM case_sop_versions'))return [[{version_number:version,plan_json:{exchangePlan:plan}}]];
  if(sql.includes('FROM case_holdings_plan_receipts'))return [[]];
    if(sql.includes('FROM case_exchange_plan_receipts'))return [[]];
  if(sql.includes('FROM case_exchange_plan_bindings'))return [events.map(e=>({stepId:e.stepId,batch_id:e.batch_id,file_type:e.stepId==='send03'?'03':'04'}))];
  if(sql.includes('INSERT INTO case_exchange_plan_bindings') || sql.includes('INSERT INTO case_exchange_plan_receipts'))return [{affectedRows:1}];
  if(sql.includes('FROM case_exchange_plan_events'))return [events];
  if(sql.includes('INSERT INTO case_exchange_plan_events'))return [{affectedRows:1}];
  throw Error(sql);
 }};return {db,calls};
}
const input={direction:'RECEIVE',fileType:'04',businessDate:'20261007',batchId:61,parseId:81,condition:'PARSED'};
test('events are read only from locked Plan version and exact workspace/chat/case, then writes use frozen version',async()=>{
 const f=dbFixture({events:[{stepId:'send03',condition:'SENT',batch_id:61}]});
 const checked=await checkExchangeOrder(f.db,keys,input);
 await recordExchangeEvent(f.db,keys,checked,{condition:'PARSED',batchId:61,parseId:81});
 assert.deepEqual(f.calls[0].values,keys);assert.match(f.calls[0].sql,/status='LOCKED'/);
 assert.deepEqual(f.calls[1].values,[...keys,7]);
 assert.deepEqual(f.calls.at(-1).values,[...keys,7,'receive04',81]);
});
test('wrong batch, replacing accepted package, absent plan and ambiguous rounds do not create completion events',async()=>{
 await assert.rejects(checkExchangeOrder(dbFixture({events:[{stepId:'send03',condition:'SENT',batch_id:62}]}).db,keys,{...input,stepId:'receive04'}),{code:'EXCHANGE_BATCH_MISMATCH'});
 const sibling=await checkExchangeOrder(dbFixture({events:[{stepId:'send03',condition:'SENT',batch_id:61},{stepId:'receive04',condition:'PARSED',batch_id:61,parse_id:82}]}).db,keys,input);assert.equal(sibling.existing,undefined);
 await assert.rejects(exchangeOrderContext(dbFixture({plan:null}).db,keys),{code:'EXCHANGE_PLAN_REQUIRED'});
 const multi=structuredClone(exchangePlan);multi.steps.push({...multi.steps[0],stepId:'sendAnother',roundId:'another'});
 await assert.rejects(checkExchangeOrder(dbFixture({plan:multi}).db,keys,{direction:'SEND',fileType:'03',businessDate:'20261006',batchId:61,condition:'SENT'}),{code:'EXCHANGE_STEP_REQUIRED'});
});
test('duplicate accepted step produces no new event and reads do not mutate versions',async()=>{
 const f=dbFixture({events:[{stepId:'send03',condition:'SENT',batch_id:61},{stepId:'receive04',condition:'PARSED',batch_id:61,parse_id:81}]});
 const checked=await checkExchangeOrder(f.db,keys,input);
 await recordExchangeEvent(f.db,keys,checked,{condition:'PARSED',batchId:61,parseId:81});
 assert.equal(f.calls.filter(c=>c.sql.includes('INSERT')).length,0);
});
