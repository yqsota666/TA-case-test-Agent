import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {createCaseHttpServer} from '../../../case-api/src/http.js';
import {buildDataFile,dataFileName} from '../../../platform-protocol/src/index.js';
// Every request goes through the production HTTP handler and repositories on the caller's rollback-only MySQL transaction.
export async function verifyHoldingsHttp({db,holdings,confirmations,token,workspaceId,channelId,scope,chatId,caseId,record}) {
 await db.query('SAVEPOINT holdings_http_acceptance');
 const origin='http://127.0.0.1:3104';
 const unreachable=()=>{throw new Error('Unexpected unrelated API invocation');};
 const server=createCaseHttpServer({allowedOrigin:origin,repository:{},discussionService:{},confirmPlan:unreachable,executeData:unreachable,reviseData:unreachable,holdingsReturn:holdings,returnConfirmation:confirmations});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,path=`/api/chats/${scope.chatPublicId}/cases/${scope.casePublicId}/holdings-return`;
 const request=async(suffix='',body,identity=token)=>{
  const response=await fetch(base+path+suffix,{method:body===undefined?'GET':'POST',headers:{cookie:`case_session=${identity}`,origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,value:await response.json()};
 };
 try {
  const options={creator:'27',receiver:'306',date:'20261007',version:'22',fileType:'05',sequence:690};
  const balanceRecord={...record,TransactionCfmDate:'20261007',TotalVolOfDistributorInTA:'350.00',AvailableVol:'320.00',TotalFrozenVol:'30.00'};
  const unknownFrozen={...balanceRecord,FundCode:'000099'};delete unknownFrozen.TotalFrozenVol;
  const file={fileName:dataFileName(options),base64:buildDataFile({...options,records:[balanceRecord,unknownFrozen]}).toString('base64')};
  const payload={channelId,exchangeStepId:'r05',files:[file]};
  const [[plan]]=await db.execute('SELECT plan_json FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=?',[workspaceId,chatId,caseId]);
  const original=typeof plan.plan_json==='string'?plan.plan_json:JSON.stringify(plan.plan_json);
  await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE workspace_id=? AND chat_id=? AND case_id=?',[JSON.stringify({exchangePlan:{status:'READY',openQuestions:[],steps:[]}}),workspaceId,chatId,caseId]);
  const noPlan=await request();assert.equal(noPlan.status,200);assert.deepEqual(noPlan.value.steps,[]);
  const rejected=await request('/parse',payload);assert.equal(rejected.status,409);assert.equal(rejected.value.error,'EXCHANGE_STEP_REQUIRED');
  await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE workspace_id=? AND chat_id=? AND case_id=?',[original,workspaceId,chatId,caseId]);
  const before=await confirmations.salesData(token);
  const parsed=await request('/parse',payload);assert.equal(parsed.status,200);assert.equal(parsed.value.phase,'PARSED');
  assert.deepEqual(await confirmations.salesData(token),before);
  const read=await request();assert.equal(read.value.planVersion,1);
  assert.ok(read.value.parses.find(p=>p.parseId===parsed.value.parseId).receipts.some(r=>r.stepId==='r05'&&Number(r.planVersion)===1));
  const foreignToken=crypto.randomBytes(32).toString('base64url'),email=crypto.randomUUID()+'@example.invalid';
  const [foreignUser]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'05HTTP隔离验收')",[crypto.randomUUID(),email,'synthetic-test-only']);
  await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),foreignUser.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[crypto.createHash('sha256').update(foreignToken).digest('hex'),foreignUser.insertId]);
  assert.equal((await request('',undefined,foreignToken)).status,404);
  assert.equal((await request('/parse',payload,foreignToken)).status,404);
  const applyBody={parseId:parsed.value.parseId,exchangeStepId:'r05'};
  assert.equal((await request('/apply',applyBody,foreignToken)).status,404);
  assert.deepEqual(await confirmations.salesData(token),before);
  const applied=await request('/apply',applyBody);assert.equal(applied.status,200);assert.equal(applied.value.businessApplied,true);assert.equal(applied.value.duplicate,false);
  const after=await confirmations.salesData(token);const balance=after.holdings.find(h=>h.transactionAccountId===record.TransactionAccountID&&h.fundCode===record.FundCode);
  assert.equal(balance.totalVolume,'350.00');assert.equal(balance.availableVolume,'320.00');assert.equal(balance.frozenVolume,'30.00');
  assert.equal(after.holdings.find(h=>h.fundCode==='000099').frozenVolume,null);
  const duplicate=await request('/apply',applyBody);assert.equal(duplicate.status,200);assert.equal(duplicate.value.duplicate,true);assert.deepEqual(await confirmations.salesData(token),after);
  const reread=await request();assert.ok(reread.value.parses.find(p=>p.parseId===parsed.value.parseId).appliedAt);
  assert.deepEqual((await confirmations.salesData(foreignToken)).holdings,[]);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.query('ROLLBACK TO SAVEPOINT holdings_http_acceptance');}
}
