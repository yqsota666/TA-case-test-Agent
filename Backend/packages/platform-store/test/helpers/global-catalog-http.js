import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {createCaseHttpServer} from '../../../case-api/src/http.js';
import {createGlobalDataCatalog} from '../../src/global-data-catalog.js';
import {createGlobalFileCatalog} from '../../src/global-file-catalog.js';
export async function verifyGlobalCatalogHttp({db,transaction,token,workspaceId}) {
 await db.query('SAVEPOINT catalog_http_acceptance');
 const origin='http://127.0.0.1:3104',unreachable=()=>{throw new Error('Unexpected unrelated API invocation');};
 const server=createCaseHttpServer({allowedOrigin:origin,repository:{},discussionService:{},confirmPlan:unreachable,executeData:unreachable,reviseData:unreachable,
  globalDataCatalog:createGlobalDataCatalog({transaction}),globalFileCatalog:createGlobalFileCatalog({transaction})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const get=(path,identity=token)=>fetch(base+'/api'+path,{headers:identity?{cookie:`case_session=${identity}`}:{}});
 try {
  const otherToken=crypto.randomBytes(32).toString('base64url');
  const [otherUser]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'全局目录隔离验收')",[crypto.randomUUID(),crypto.randomUUID()+'@example.invalid','synthetic-test-only']);
  const [otherWorkspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),otherUser.insertId]);
  assert.notEqual(String(otherWorkspace.insertId),String(workspaceId));
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[crypto.createHash('sha256').update(otherToken).digest('hex'),otherUser.insertId]);
  const searchFailures=[];
  for(const table of ['customers','accounts','funds','holdings','applications'])for(const source of ['draft','formal']){
   const path=`/data/tables/${table}?source=${source}&limit=200`;
   const response=await get(path);assert.equal(response.status,200,`${table}/${source}`);const data=await response.json();assert.ok(data.total>0,`${table}/${source} has actual fixture records`);assert.ok(data.rows.length>0);assert.ok(data.columns.length>0);
   const foreign=await get(path,otherToken);assert.equal(foreign.status,200);const empty=await foreign.json();assert.deepEqual(empty.rows,[]);assert.equal(empty.total,0);
   const first=await get(path.replace('limit=200','limit=1')+'&offset=0');assert.equal(first.status,200);const page=await first.json();assert.equal(page.rows.length,1);assert.equal(page.total,data.total);
   const noMatch=await get(path+'&q='+encodeURIComponent(crypto.randomUUID()));assert.equal(noMatch.status,200);assert.equal((await noMatch.json()).total,0);
   const sample=Object.entries(data.rows[0]).find(([key,value])=>!['chatId','caseId','project','caseTitle'].includes(key)&&typeof value==='string'&&value.length>0)?.[1];
   assert.ok(sample);const searched=await get(path+'&q='+encodeURIComponent(sample));assert.equal(searched.status,200);if(!(await searched.json()).total)searchFailures.push(table+'/'+source+' visible field search');
   const scopedSearch=await get(path+'&q='+encodeURIComponent(sample)+'&workspaceId='+workspaceId,otherToken);assert.equal(scopedSearch.status,200);assert.equal((await scopedSearch.json()).total,0);
  }
  assert.equal((await get('/data/tables/customers',null)).status,401);
  assert.equal((await get('/data/tables/customers?offset=-1')).status,400);
  const fileResponse=await get('/files/catalog?limit=200');assert.equal(fileResponse.status,200);const listing=await fileResponse.json();assert.ok(listing.files.length>0);
  const foreignListing=await get('/files/catalog?limit=200',otherToken);assert.equal(foreignListing.status,200);assert.deepEqual((await foreignListing.json()).files,[]);
  for(const kind of ['outbound','return','holdings']){
   const file=listing.files.find(file=>file.kind===kind);assert.ok(file,`${kind} real file available`);
   const path='/files/catalog/download?'+new URLSearchParams({kind,id:file.locator,fileName:file.fileName});
   const own=await get(path);assert.equal(own.status,200);const bytes=Buffer.from(await own.arrayBuffer());assert.equal(bytes.length,Number(file.byteLength));
   const table={outbound:'exchange_files',return:'case_return_parse_files',holdings:'case_holdings_return_files'}[kind];
   const [[stored]]=await db.execute(`SELECT raw_bytes FROM ${table} WHERE workspace_id=? AND ${kind==='outbound'?'id':'parse_id'}=? AND file_name=?`,[workspaceId,file.locator,file.fileName]);assert.deepEqual(bytes,stored.raw_bytes);
   assert.equal((await get(path,otherToken)).status,404);assert.equal((await get(path,null)).status,401);
  }
  assert.deepEqual(searchFailures,[]);
  assert.equal((await get('/files/catalog?limit=201')).status,400);
  const none=await get('/files/catalog?q='+encodeURIComponent(crypto.randomUUID()));assert.equal(none.status,200);assert.equal((await none.json()).total,0);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.query('ROLLBACK TO SAVEPOINT catalog_http_acceptance');}
}
