import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createDiscussionContextReader} from '../src/discussion-context.js';
import {workflowScope} from '../src/durable-workflow.js';

test('MySQL discussion snapshots are read-only, scoped, and reflect intent-driven draft invalidation',
 {skip:process.env.CASE_REPLY_CONTEXT_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());
 await db.beginTransaction();
 const transaction=action=>action(db),business=createCaseRepository({transaction});
 const owner=async()=>{
  const token=randomBytes(32).toString('base64url'),id=randomUUID();
  const [user]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成回复测试')`,[id,id+'@example.invalid','synthetic']);
  await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  return token;
 };
 try{
  const token=await owner(),foreign=await owner(),chat=await business.createChat(token,'合成回复快照');
  const item=await business.createCase(token,chat.publicId,'合成状态核对'),scope={chatPublicId:chat.publicId,casePublicId:item.publicId};
  const read=createDiscussionContextReader({transaction:action=>action({execute:(sql,args)=>{assert.match(sql,/^\s*SELECT\b/i);return db.execute(sql,args);}})});
  assert.equal((await read(token,scope)).stage,'DISCUSSION');
  await assert.rejects(read(foreign,scope),{code:'CASE_NOT_FOUND'});
  const other=await business.createChat(token,'其他合成项目');
  await assert.rejects(read(token,{...scope,chatPublicId:other.publicId}),{code:'CASE_NOT_FOUND'});
  const proposal={objective:'核对订单状态',preconditions:[],scenarios:[{title:'状态变化',setup:'合成订单',action:'请求撤销',expected:'遵循提供的状态规则',evidence:'响应记录'}],openQuestions:[]};
  await business.saveSopProposal(token,chat.publicId,item.publicId,proposal);
  const {keys}=await workflowScope(db,token,scope);
  const [[actor]]=await db.execute('SELECT user_id FROM platform_sessions WHERE token_hash=?',[sessionTokenHash(token)]);
  await db.execute(`INSERT INTO case_plan_section_confirmations(workspace_id,chat_id,case_id,version_number,section,actor_user_id) VALUES (?,?,?,1,'DATA',?)`,[...keys,actor.user_id]);
  const pending=await read(token,scope);
  assert.equal(pending.stage,'CONFIRM_EXPECTATIONS');assert.equal(pending.confirmations.expectations,false);
  await business.beginCaseDiscussionTurn(token,chat.publicId,item.publicId,{expectedRevision:0,userInput:'还需要改哪些条件？'});
  const current=await read(token,scope);
  assert.equal(current.stage,'DISCUSSION');assert.equal(current.plan.status,'DRAFT');
  assert.equal(current.draft.generated,false);assert.equal(current.artifacts.items.length,0);
 }finally{await db.rollback();await db.end();}
});
