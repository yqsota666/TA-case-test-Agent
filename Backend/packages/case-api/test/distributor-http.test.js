import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaseHttpServer} from '../src/http.js';
import {distributorInput} from '../../platform-store/src/distributor-config.js';
test('sales distributor table and saves require session, same origin and validated input',async t=>{
 const calls=[],noop=()=>{},origin='http://localhost:3106';
 const server=createCaseHttpServer({repository:{},discussionService:{},confirmPlan:noop,executeData:noop,reviseData:noop,allowedOrigin:origin,
  globalDataCatalog:{deliveryDefaults:async(token,input)=>{calls.push({token,input});return {profile:{includeEmptyR1:true}};},listTable:async(token,input)=>{calls.push({token,input});return {rows:[],columns:[]};},saveDistributor:async(token,{id,input})=>{distributorInput(input);calls.push({token,id,input});return {id:id??'81',...input};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,path='/api/data/distributors',input={channel_name:'中国建设银行',distributor_code:'005',ta_code:'27',protocol_version:'22',ta_environment:'LOCAL'};
 const headers={cookie:'case_session=test',origin,'content-type':'application/json'},write=(suffix='',body=input,h=headers)=>fetch(base+path+suffix,{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await write('',input,{...headers,cookie:''})).status,401);
 assert.equal((await write('',input,{...headers,origin:'https://foreign.example'})).status,403);
 assert.equal((await write('',input,{...headers,'content-type':'text/plain'})).status,415);
 assert.equal((await write('',{...input,workspace_id:99})).status,400);
 const added=await write();assert.equal(added.status,201);assert.equal((await added.json()).distributor_code,'005');
 assert.equal((await write('/81')).status,200);
 assert.equal((await fetch(base+'/api/data/tables/distributors',{headers})).status,200);
 assert.equal(calls.length,3);assert.equal(calls[1].id,'81');assert.equal(calls[2].input.table,'distributors');
 const defaults=base+'/api/data/distributors/default-profile?distributorCode=227&taCode=27&protocolVersion=22';
 assert.equal((await fetch(defaults)).status,401);
 assert.equal((await fetch(defaults,{headers})).status,200);
 assert.deepEqual(calls.at(-1).input,{distributorCode:'227',taCode:'27',protocolVersion:'22'});
 assert.equal((await write('/81',{...input,delivery_profile:{aml:false}})).status,200);
 assert.equal(calls.at(-1).input.delivery_profile.aml,false);
});
