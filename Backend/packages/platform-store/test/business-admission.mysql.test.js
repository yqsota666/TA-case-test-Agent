import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createAdmissionRepository} from '../src/business-admission.js';

test('MySQL admission leases serialize duplicate inputs, cache decisions and reject foreign scope',
 {skip:process.env.CASE_ADMISSION_MYSQL!=='1'},async()=>{
 const pool=mysql.createPool({...migrationConfig(),connectionLimit:6});
 const transaction=async action=>{const db=await pool.getConnection();try{await db.beginTransaction();const value=await action(db);await db.commit();return value;}catch(e){await db.rollback();throw e;}finally{db.release();}};
 const owner=async()=>{const token=randomBytes(32).toString('base64url'),id=randomUUID();await transaction(async db=>{
  const [user]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成准入测试')`,[id,id+'@example.invalid','synthetic']);
  await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
 });return token;};
 try{
  const token=await owner(),foreign=await owner(),business=createCaseRepository({transaction});
  const chat=await business.createChat(token,'合成准入项目'),item=await business.createCase(token,chat.publicId,'开户字段校验');
  const a=createAdmissionRepository({transaction}),b=createAdmissionRepository({transaction}),hash='a'.repeat(64);
  const scope=[token,chat.publicId,item.publicId];
  const first=await a.claim(...scope,hash);
  const concurrent=await Promise.allSettled([a.claim(...scope,hash),b.claim(...scope,hash)]);
  assert.ok(concurrent.every(r=>r.status==='rejected'&&r.reason.code==='ADMISSION_IN_PROGRESS'));
  await a.finish(...scope,hash,first.lease,{decision:'REJECT'});
  assert.deepEqual(await b.claim(...scope,hash),{result:{decision:'REJECT'}});
  await assert.rejects(a.context(foreign,chat.publicId,item.publicId),{code:'CASE_NOT_FOUND'});
  assert.equal((await business.readCaseDiscussion(...scope)).revision,0);
  assert.equal((await a.context(token,chat.publicId.toUpperCase(),item.publicId.toUpperCase())).case,'开户字段校验');
  for(let i=0;i<8;i++){
   const pending=await business.beginCaseDiscussionTurn(...scope,{expectedRevision:i,userInput:i===0?'最初目标是合成状态转换测试':'合成后续需求'+i});
   await business.finishCaseDiscussionTurn(...scope,{turnNumber:pending.turnNumber,assistantReply:'本轮合成建议'+i,promptVersion:'synthetic-context-test'});
  }
  await transaction(db=>db.execute(`UPDATE case_discussion_turns t JOIN cases k ON k.workspace_id=t.workspace_id AND k.chat_id=t.chat_id AND k.id=t.case_id SET t.assistant_text=? WHERE k.public_id=? AND t.turn_number=8`,['本轮合成建议7'+'x'.repeat(6500),item.publicId]));
  await business.beginCaseDiscussionTurn(...scope,{expectedRevision:8,userInput:'尚未完成的回合不能进入审核上下文'});
  const context=await a.context(...scope);
  assert.equal(context.initialRequirement,'最初目标是合成状态转换测试');
  assert.equal(context.recentRequirements.length,6);assert.equal(context.recentConversation.length,12);
  assert.equal(context.recentConversation[0].revision,3);assert.equal(context.recentConversation[0].role,'user');
  assert.equal(context.recentConversation[1].role,'assistant');assert.match(context.recentConversation[1].content,/本轮合成建议2/);
  assert.equal(context.recentConversation.at(-1).revision,8);assert.equal(context.recentConversation.at(-1).content.length,6000);
  assert.ok(context.recentConversation.every(t=>t.revision<=8));

 }finally{await pool.end();}
});
