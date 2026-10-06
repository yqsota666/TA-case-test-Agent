import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoldingsParsingGraph,createHoldingsSyncGraph } from '../src/holdings-return-graph.js';
const channel={taCode:'27',distributorCode:'306',protocolVersion:'22'};
test('independent 05 graph waits without outbound batch and verifies before synchronizing',async()=>{
 assert.equal((await createHoldingsParsingGraph({channel}).invoke({})).phase,'WAITING_UPLOAD');
 let applied=false;
 const graph=createHoldingsSyncGraph({channel,sync:async rows=>{applied=true;assert.deepEqual(rows,[]);return {businessApplied:false};}});
 const state=await graph.invoke({parsed:{files:[]}});assert.equal(state.phase,'SYNCED');assert.equal(applied,true);
 applied=false;
 await assert.rejects(graph.invoke({parsed:{files:[{date:'20261007',fileName:'x',records:[{DetailFlag:'9'}]}]}}));assert.equal(applied,false);
});
