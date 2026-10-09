import test from 'node:test';
import assert from 'node:assert/strict';
import {createDistributorConfig,distributorInput} from '../src/distributor-config.js';
import {createGlobalDataCatalog} from '../src/global-data-catalog.js';
const token='a'.repeat(43),input={channel_name:'广发基金',distributor_code:'227',ta_code:'27',protocol_version:'22',ta_environment:'LOCAL'};
function fixture({current=input,duplicate=false}={}){
 const calls=[],transaction=async fn=>fn({execute:async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('platform_sessions'))return [[{workspace_id:37,user_id:8}]];
  if(sql.includes('FOR UPDATE'))return [current?[current]:[]];
  if(sql.startsWith('INSERT')&&duplicate)throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});
  return [{insertId:71}];
 }});
 return {calls,repo:createDistributorConfig({transaction})};
}
test('new sales distributor preserves leading zeros and persists into the generation channel',async()=>{
 const f=fixture(),result=await f.repo.saveDistributor(token,{input:{...input,distributor_code:'005'}});
 assert.equal(result.id,'71');assert.equal(result.distributor_code,'005');
 assert.match(f.calls[1].sql,/INSERT INTO exchange_channels/);assert.deepEqual(f.calls[1].values,[37,'广发基金','005','27','22','LOCAL']);
});
test('sales distributor input rejects unknown fields, control characters and invalid protocol identifiers',()=>{
 for(const value of [null,[],{...input,workspace_id:99},{...input,distributor_code:'227/..'},{...input,ta_code:'1234567890'},{...input,protocol_version:'23'},{...input,channel_name:' '},{...input,ta_environment:'LOCAL\nBAD'}])assert.throws(()=>distributorInput(value),{code:'INVALID_DISTRIBUTOR'});
});
test('renaming is scoped and identity changes never rewrite historical channel attribution',async()=>{
 const f=fixture();await f.repo.saveDistributor(token,{id:'71',input:{...input,channel_name:'广发'}});
 assert.deepEqual(f.calls.at(-1).values,['广发',37,'71']);assert.match(f.calls.at(-1).sql,/SET channel_name=\? WHERE workspace_id=\? AND id=\?/);
 for(const key of ['distributor_code','ta_code','protocol_version','ta_environment']){
  const changed=fixture();await assert.rejects(()=>changed.repo.saveDistributor(token,{id:'71',input:{...input,[key]:key==='protocol_version'?'21':'OTHER'}}),{code:'CHANNEL_IDENTITY_IMMUTABLE'});
  assert.ok(!changed.calls.some(({sql})=>sql.startsWith('UPDATE')));
 }
});
test('foreign channel cannot be edited and duplicate route reports an actionable error',async()=>{
 await assert.rejects(()=>fixture({current:null}).repo.saveDistributor(token,{id:'71',input}),{code:'CHANNEL_NOT_FOUND'});
 await assert.rejects(()=>fixture({duplicate:true}).repo.saveDistributor(token,{input}),{code:'DISTRIBUTOR_EXISTS'});
});
test('sales distributor catalog has stable empty columns and scoped literal search',async()=>{
 const calls=[],repo=createGlobalDataCatalog({transaction:async fn=>fn({execute:async(sql,values)=>{
  calls.push({sql,values});if(sql.includes('platform_sessions'))return [[{workspace_id:37}]];
  if(sql.includes('COUNT(*)'))return [[{total:0}]];return [[]];
 }})});
 const result=await repo.listTable(token,{table:'distributors',q:'%_'});
 assert.equal(result.columns[0].key,'distributor_code');assert.equal(result.columns.length,5);assert.deepEqual(result.rows,[]);
 for(const {sql,values} of calls.slice(1)){assert.match(sql,/WHERE workspace_id=\?/);assert.equal(values[0],37);assert.ok(values.slice(1).every(v=>v==='%\\%\\_%'));}
});
