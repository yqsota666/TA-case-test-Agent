import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCaseHttpServer} from '../src/http.js';
import {catalogOptions} from '../../platform-store/src/global-data-catalog.js';
import {fileCatalogOptions} from '../../platform-store/src/global-file-catalog.js';
test('advanced catalog fields and timezone are forwarded while workspace selectors are ignored',async t=>{
 const f=await fixture(t),filters=JSON.stringify({combinator:'and',rules:[{field:'status',operator:'eq',value:'READY'}]}),sort=JSON.stringify([{field:'created_at',direction:'desc'}]);
 const params=new URLSearchParams({filters,sort,timeZone:'Asia/Shanghai',optionsField:'project',workspaceId:'999'});
 for(const path of ['/api/data/tables/applications','/api/files/catalog']) {
  const response=await fetch(f.base+path+'?'+params,{headers:{cookie}});assert.equal(response.status,200);
  const input=f.calls.at(-1)[2];assert.equal(input.filters,filters);assert.equal(input.sort,sort);assert.equal(input.timeZone,'Asia/Shanghai');assert.equal(input.optionsField,'project');assert.equal(input.workspaceId,undefined);
 }
 assert.equal((await fetch(f.base+'/api/files/catalog?timeZone=invalid',{headers:{cookie}})).status,400);
});
test('POST search accepts long condition bodies, checks origin/account, and keeps download GET-only',async t=>{
 const f=await fixture(t),body={q:'客户',filters:{combinator:'and',rules:[{field:'name',operator:'in',value:Array(60).fill('长文本条件'.repeat(20))}]},sort:[]};
 const headers={cookie,origin:'http://localhost:5195','content-type':'application/json','X-Case-Account':'owner'};
 for(const path of ['/api/data/tables/customers/search','/api/files/catalog/search']) {
  assert.equal((await fetch(f.base+path,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.deepEqual(f.calls.at(-1)[2].filters,body.filters);
  assert.equal((await fetch(f.base+path,{method:'POST',headers:{...headers,origin:'https://other.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(f.base+path,{method:'POST',headers:{...headers,'X-Case-Account':'other'},body:'{}'})).status,409);
  assert.equal((await fetch(f.base+path,{method:'POST',headers,body:'null'})).status,400);
  assert.equal((await fetch(f.base+path,{method:'POST',headers,body:JSON.stringify({q:'x'.repeat(33000)})})).status,413);
 }
 assert.equal((await fetch(f.base+'/api/files/catalog/download',{method:'POST',headers,body:'{}'})).status,404);
});
const token='a'.repeat(43),cookie=`case_session=${token}`;
async function fixture(t){const calls=[];const checked=value=>{if(value!==token)throw Object.assign(new Error('请重新登录'),{status:401,code:'UNAUTHENTICATED'});};const server=createCaseHttpServer({repository:{},discussionService:{},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{},allowedOrigin:'http://localhost:5195',accountAuth:{current:async value=>{checked(value);return {user:{id:'owner'}};}},globalDataCatalog:{listTable:async(value,input)=>{checked(value);calls.push(['data',value,catalogOptions(input)]);return {rows:[{name:'本账户客户'}]};}},globalFileCatalog:{listFiles:async(value,input)=>{checked(value);calls.push(['files',value,fileCatalogOptions(input)]);return {files:[]};},downloadFile:async(value,input)=>{checked(value);calls.push(['download',value,input]);if(input.id==='999')throw Object.assign(new Error('文件不存在或无法访问'),{status:404,code:'FILE_NOT_FOUND'});return {fileName:'OFD_TEST.TXT',rawBytes:Buffer.from([0,255,10,13])};}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});return {calls,base:`http://127.0.0.1:${server.address().port}`};}
test('global data and file routes require a valid session and reject stale account headers',async t=>{const f=await fixture(t);for(const path of ['/api/data/tables/customers','/api/files/catalog','/api/files/catalog/download?kind=outbound&id=1&fileName=OFD_TEST.TXT']){assert.equal((await fetch(f.base+path)).status,401);assert.equal((await fetch(f.base+path,{headers:{cookie:'case_session='+ 'b'.repeat(43)}})).status,401);assert.equal((await fetch(f.base+path,{headers:{cookie,'X-Case-Account':'other'}})).status,409);}assert.equal(f.calls.length,0);});
test('data search pagination and source pass to the scoped catalog, malformed input is rejected',async t=>{const f=await fixture(t);const r=await fetch(f.base+'/api/data/tables/accounts?source=formal&q=%E5%AE%A2%E6%88%B7&offset=100&limit=50',{headers:{cookie,'X-Case-Account':'owner'}});assert.equal(r.status,200);assert.deepEqual(f.calls[0],['data',token,{table:'accounts',source:'formal',q:'客户',offset:100,limit:50}]);assert.equal(r.headers.get('cache-control'),'no-store');for(const suffix of ['customers?limit=201','customers?offset=-1','unknown'])assert.equal((await fetch(f.base+'/api/data/tables/'+suffix,{headers:{cookie}})).status,400);assert.equal((await fetch(f.base+'/api/data/tables/customers',{method:'POST',headers:{cookie}})).status,404);});
test('file catalog forwards only query fields; download sends original bytes and no-store headers',async t=>{const f=await fixture(t);assert.equal((await fetch(f.base+'/api/files/catalog?q=03&offset=20',{headers:{cookie}})).status,200);assert.deepEqual(f.calls[0],['files',token,{q:'03',offset:20,limit:100}]);const path='/api/files/catalog/download?kind=return&id=8&fileName=OFD_TEST.TXT';const r=await fetch(f.base+path,{headers:{cookie}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from([0,255,10,13]));assert.equal(r.headers.get('content-disposition'),'attachment; filename="OFD_TEST.TXT"');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await fetch(f.base+path.replace('id=8','id=999'),{headers:{cookie}})).status,404);});
