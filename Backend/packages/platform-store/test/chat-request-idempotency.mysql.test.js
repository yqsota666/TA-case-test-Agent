import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {applyMigrations,migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createChatLifecycleRepository} from '../src/chat-lifecycle.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const requestId=()=>crypto.randomUUID().toUpperCase();
async function signal(gate){let timer;try{await Promise.race([gate.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('expected transaction lock signal did not arrive')),8000);})]);}finally{clearTimeout(timer);}}

test('MySQL: Chat run UUID casing serializes concurrent replays, accepts legacy uppercase and retains source/workspace scope',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1',timeout:60000},async()=>{
 const config=migrationConfig(),database='ta_case_agent_testchatrequest'+crypto.randomBytes(8).toString('hex');
 const root=await mysql.createConnection({...config,database:undefined});let db,a,b;
 try{
  await root.query(`CREATE DATABASE ${database}`);
  db=await mysql.createConnection({...config,database});await applyMigrations(db);
  a=await mysql.createConnection({...config,database});b=await mysql.createConnection({...config,database});
  const transaction=connection=>async action=>{await connection.beginTransaction();try{const result=await action(connection);await connection.commit();return result;}catch(e){await connection.rollback();throw e;}};
  async function owner(){
   const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
   const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成UUID回归')",[id,id+'@example.invalid','synthetic']);
   const [ws]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
   await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
   return {token,userId:user.insertId,workspaceId:ws.insertId};
  }
  const first=await owner(),second=await owner();
  const repo=createCaseRepository({transaction:transaction(db)}),life=createChatLifecycleRepository({transaction:transaction(db)});
  async function closed(token){const chat=await repo.createChat(token,'合成封存轮次');await life.close(token,{chatPublicId:chat.publicId,mode:'FORCE',reason:'合成测试封存'});return chat.publicId;}
  async function failed(token){
   const chat=await repo.createChat(token,'合成复测父Chat'),source=await repo.createCase(token,chat.publicId,'合成失败');
   const [[scope]]=await db.execute('SELECT id,workspace_id,chat_id FROM cases WHERE public_id=?',[source.publicId]);
   const [[user]]=await db.execute('SELECT owner_user_id FROM workspaces WHERE id=?',[scope.workspace_id]);
   await db.execute("UPDATE cases SET status='FAIL' WHERE id=?",[scope.id]);
   await db.execute("INSERT INTO case_sop_versions(workspace_id,chat_id,case_id,version_number,plan_json) VALUES (?,?,?,1,'{}')",[scope.workspace_id,scope.chat_id,scope.id]);
   await db.execute("INSERT INTO case_result_reviews(workspace_id,chat_id,case_id,plan_version,evidence_sha256,evidence_json,suggestion_json,actor_user_id,final_verdict,confirmation_reason,confirmed_by_user_id,confirmed_at) VALUES (?,?,?,1,?,'{}','{}',?,'FAIL','合成失败',?,NOW())",[scope.workspace_id,scope.chat_id,scope.id,'0'.repeat(64),user.owner_user_id,user.owner_user_id]);
   return {chatPublicId:chat.publicId,casePublicId:source.publicId};
  }
  async function race(method,input){
   const created=deferred(),release=deferred(),waiting=deferred();
   const one=createChatLifecycleRepository({transaction:async action=>{await a.beginTransaction();try{const result=await action(a);created.resolve();await release.promise;await a.commit();return result;}catch(e){created.resolve();await a.rollback();throw e;}}});
   const proxy={execute:async(sql,args)=>{if(sql.includes('FROM case_chats WHERE workspace_id=')&&sql.endsWith('FOR UPDATE'))waiting.resolve();return b.execute(sql,args);}};
   const two=createChatLifecycleRepository({transaction:async action=>{await b.beginTransaction();try{const result=await action(proxy);await b.commit();return result;}catch(e){await b.rollback();throw e;}}});
   let left,right;
   try{
    left=one[method](first.token,input);await signal(created);
    right=two[method](first.token,{...input,requestId:input.requestId.toLowerCase(),...(input.casePublicId?{casePublicId:input.casePublicId.toUpperCase()}: {})});
    await signal(waiting);
   }finally{release.resolve();}
   const [original,replay]=await Promise.all([left,right]);
   assert.equal(original.duplicate,false);assert.equal(replay.duplicate,true);assert.equal(replay.chatPublicId,original.chatPublicId);assert.equal(replay.casePublicId,original.casePublicId);
   return original;
  }
  const sharedId=requestId(),chatPublicId=await closed(first.token),newInput={chatPublicId,requestId:sharedId,reason:'合成新轮次',confirmPreserveFormalData:true};
  const next=await race('newRun',newInput);
  const [[link]]=await db.execute('SELECT request_id,source_chat_id FROM chat_run_links WHERE workspace_id=? AND target_chat_id=(SELECT id FROM case_chats WHERE public_id=?)',[first.workspaceId,next.chatPublicId]);
  assert.equal(link.request_id,sharedId.toLowerCase());
  const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM chat_run_links WHERE workspace_id=? AND source_chat_id=?',[first.workspaceId,link.source_chat_id]);assert.equal(Number(count.n),1);
  await assert.rejects(life.newRun(first.token,{...newInput,requestId:sharedId.toLowerCase(),reason:'不同原因'}),{code:'RUN_REQUEST_CONFLICT'});
  // A legacy uppercase row stays untouched while lowercase replay returns its original target.
  await db.execute('UPDATE chat_run_links SET request_id=? WHERE workspace_id=? AND source_chat_id=?',[sharedId,first.workspaceId,link.source_chat_id]);
  const legacy=await life.newRun(first.token,{...newInput,requestId:sharedId.toLowerCase()});assert.equal(legacy.duplicate,true);assert.equal(legacy.chatPublicId,next.chatPublicId);
  const [[preserved]]=await db.execute('SELECT request_id,reason FROM chat_run_links WHERE workspace_id=? AND source_chat_id=?',[first.workspaceId,link.source_chat_id]);assert.equal(preserved.request_id,sharedId);assert.equal(preserved.reason,newInput.reason);
  const anotherChat=await closed(first.token),sameWorkspace=await life.newRun(first.token,{...newInput,chatPublicId:anotherChat,requestId:sharedId.toLowerCase()});assert.equal(sameWorkspace.duplicate,false);assert.notEqual(sameWorkspace.chatPublicId,next.chatPublicId);
  const otherChat=await closed(second.token),crossWorkspace=await life.newRun(second.token,{...newInput,chatPublicId:otherChat,requestId:sharedId.toLowerCase()});assert.equal(crossWorkspace.duplicate,false);assert.notEqual(crossWorkspace.chatPublicId,next.chatPublicId);
  await assert.rejects(life.newRun(second.token,newInput),{code:'CHAT_NOT_FOUND'});
  const scope=await failed(first.token),retryInput={...scope,requestId:requestId(),reason:'合成关联复测'};
  const retry=await race('retest',retryInput);assert.equal(retry.chatPublicId,scope.chatPublicId);
  await db.execute('UPDATE chat_run_links SET request_id=? WHERE workspace_id=? AND target_case_id=(SELECT id FROM cases WHERE public_id=?)',[retryInput.requestId,first.workspaceId,retry.casePublicId]);
  const retried=await life.retest(first.token,{...retryInput,requestId:retryInput.requestId.toLowerCase(),casePublicId:scope.casePublicId.toUpperCase()});assert.equal(retried.duplicate,true);assert.equal(retried.casePublicId,retry.casePublicId);
  const [[legacyRetry]]=await db.execute('SELECT request_id,reason FROM chat_run_links WHERE workspace_id=? AND target_case_id=(SELECT id FROM cases WHERE public_id=?)',[first.workspaceId,retry.casePublicId]);assert.equal(legacyRetry.request_id,retryInput.requestId);assert.equal(legacyRetry.reason,retryInput.reason);
  await assert.rejects(life.retest(first.token,{...retryInput,requestId:retryInput.requestId.toLowerCase(),reason:'另一原因'}),{code:'RUN_REQUEST_CONFLICT'});
  await assert.rejects(life.retest(first.token,{...retryInput,requestId:retryInput.requestId.toLowerCase(),casePublicId:retry.casePublicId}),{code:'RUN_REQUEST_CONFLICT'});
  await assert.rejects(life.newRun(first.token,{...retryInput,requestId:retryInput.requestId.toLowerCase(),confirmPreserveFormalData:true}),{code:'RUN_REQUEST_CONFLICT'});
  await assert.rejects(life.retest(second.token,{...retryInput,requestId:retryInput.requestId.toLowerCase()}),{code:'CHAT_NOT_FOUND'});
  const [[children]]=await db.execute('SELECT COUNT(*) AS n FROM cases WHERE workspace_id=? AND predecessor_case_id=(SELECT id FROM cases WHERE public_id=?)',[first.workspaceId,scope.casePublicId]);assert.equal(Number(children.n),1);
 }finally{
  if(a)await a.end();if(b)await b.end();if(db)await db.end();await root.query(`DROP DATABASE IF EXISTS ${database}`);await root.end();
 }
});
