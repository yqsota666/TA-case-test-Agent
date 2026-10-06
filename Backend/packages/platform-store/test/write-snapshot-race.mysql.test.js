import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {applyMigrations,migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createExchangeRepository} from '../src/exchange.js';
import {createChatLifecycleRepository} from '../src/chat-lifecycle.js';
const gate=()=>{let release;return {ready:new Promise(r=>{release=r;}),release:()=>release()};};
test('MySQL: post-lock draft revisions, full Chat barrier, human verdict and run replay use current reads',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1',timeout:60000},async()=>{
 const config=migrationConfig(),database='ta_case_agent_testwriterace'+crypto.randomBytes(8).toString('hex');
 const root=await mysql.createConnection({...config,database:undefined});let writer,reader;
 try{
  await root.query(`CREATE DATABASE ${database}`);
  writer=await mysql.createConnection({...config,database});reader=await mysql.createConnection({...config,database});await applyMigrations(writer);
  const token=crypto.randomBytes(32).toString('base64url'),publicId=crypto.randomUUID();
  const [user]=await writer.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成竞争测试')",[publicId,publicId+'@example.invalid','synthetic']);
  const [workspace]=await writer.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);const w=workspace.insertId;
  await writer.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  const fixture=async()=>{
   const chatId=crypto.randomUUID(),caseId=crypto.randomUUID();
   const [chat]=await writer.execute('INSERT INTO case_chats(public_id,workspace_id,title) VALUES (?, ?, ?)',[chatId,w,'合成竞争']);
   const [item]=await writer.execute("INSERT INTO cases(public_id,workspace_id,chat_id,title,status) VALUES (?,?,?,?,'SOP_LOCKED')",[caseId,w,chat.insertId,'合成Case']);const keys=[w,chat.insertId,item.insertId];
   const [plan]=await writer.execute("INSERT INTO case_sop_versions(workspace_id,chat_id,case_id,version_number,plan_json,status,locked_at) VALUES (?,?,?,1,'{}','LOCKED',UTC_TIMESTAMP())",keys);
   await writer.execute("INSERT INTO case_data_executions(workspace_id,chat_id,case_id,sop_version_id,specification_json) VALUES (?,?,?,?,'{}')",[...keys,plan.insertId]);return {chatId,caseId,keys,plan:plan.insertId};
  };
  const transaction=async action=>{await reader.beginTransaction();try{const r=await action(reader);await reader.commit();return r;}catch(e){await reader.rollback();throw e;}};
  // Authentication opens an RR snapshot while the other connection owns the Chat lock.
  const race=async(f,mutate,invoke)=>{
   await writer.beginTransaction();await writer.execute('SELECT id FROM case_chats WHERE workspace_id=? AND public_id=? FOR UPDATE',[w,f.chatId]);
   const snapshot=gate(),original=reader.execute.bind(reader);reader.execute=async(sql,args)=>{const r=await original(sql,args);if(sql.includes('FROM platform_sessions'))snapshot.release();return r;};
   let settled=false;const pending=invoke(transaction).then(result=>({result}),error=>({error})).finally(()=>{settled=true;});
   try{await snapshot.ready;await new Promise(r=>setTimeout(r,50));assert.equal(settled,false);await mutate();await writer.commit();return await pending;}
   finally{await writer.rollback();reader.execute=original;await pending;}
  };
  const replay=await fixture();await writer.execute('DELETE FROM case_data_executions WHERE workspace_id=? AND chat_id=? AND case_id=?',replay.keys);
  const replayResult=await race(replay,async()=>{
   await writer.execute("INSERT INTO case_data_executions(workspace_id,chat_id,case_id,sop_version_id,specification_json) VALUES (?,?,?,?,'{}')",[...replay.keys,replay.plan]);
   await writer.execute("INSERT INTO case_generated_funds(workspace_id,chat_id,case_id,fund_code,fund_name,share_class,nav) VALUES (?,?,?,'880031','synthetic replay','A',1)",replay.keys);
   await writer.execute("INSERT INTO case_data_edit_events(workspace_id,chat_id,case_id,revision,edit_json) VALUES (?,?,?,2,'{}')",replay.keys);
   await writer.execute('INSERT INTO case_data_confirmations(workspace_id,chat_id,case_id,revision,actor_user_id) VALUES (?,?,?,2,?)',[...replay.keys,user.insertId]);
  },tx=>createCaseRepository({transaction:tx}).executeGeneratedData(token,replay.chatId,replay.caseId,1,{},async()=>{throw Error('replay must not execute graph');}));
  assert.equal(replayResult.result?.status,'VALIDATED','replay reads the committed execution after waiting');
  assert.equal(replayResult.result.replayed,true);assert.equal(replayResult.result.funds[0].fund_code,'880031');
  assert.equal(replayResult.result.revision,2);assert.equal(replayResult.result.reviewStatus,'CONFIRMED');
  const draft=await fixture();let outcome=await race(draft,()=>writer.execute("INSERT INTO case_data_edit_events(workspace_id,chat_id,case_id,revision,edit_json) VALUES (?,?,?,1,'{}')",draft.keys),tx=>createCaseRepository({transaction:tx}).confirmGeneratedData(token,draft.chatId,draft.caseId,0));
  assert.equal(outcome.error?.code,'DATA_EDIT_CONFLICT','old revision cannot confirm new draft');
  const edited=await fixture();await writer.execute("INSERT INTO case_data_edit_events(workspace_id,chat_id,case_id,revision,edit_json) VALUES (?,?,?,1,'{}')",edited.keys);
  outcome=await race(edited,()=>writer.execute('INSERT INTO case_data_confirmations(workspace_id,chat_id,case_id,revision,actor_user_id) VALUES (?,?,?,1,?)',[...edited.keys,user.insertId]),tx=>createCaseRepository({transaction:tx}).editGeneratedData(token,edited.chatId,edited.caseId,{revision:1,changes:{customers:[],accounts:[],funds:[],holdings:[]}}));
  assert.equal(outcome.error?.code,'DATA_ALREADY_CONFIRMED','waiting edit cannot modify confirmed data');
  const batch=await fixture();await writer.execute('INSERT INTO case_data_confirmations(workspace_id,chat_id,case_id,revision,actor_user_id) VALUES (?,?,?,0,?)',[...batch.keys,user.insertId]);
  const [channel]=await writer.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'合成','synthetic','SYNTA01','306','22')",[w]);
  const app=crypto.randomUUID();await writer.execute("INSERT INTO applications(public_id,workspace_id,chat_id,case_id,sop_version_id,channel_id,business_date,file_type,business_code,app_no,record_json,snapshot_hash) VALUES (?,?,?,?,?,?,'2026-10-11','01','001',?,'{}',?)",[app,...batch.keys,batch.plan,channel.insertId,crypto.randomBytes(8).toString('hex'),'0'.repeat(64)]);
  outcome=await race(batch,()=>writer.execute('INSERT INTO cases(public_id,workspace_id,chat_id,title) VALUES (?,?,?,?)',[crypto.randomUUID(),w,batch.keys[1],'未确认Case']),tx=>createExchangeRepository({transaction:tx}).createOutboundBatch(token,{chatPublicId:batch.chatId,channelId:channel.insertId,businessDate:'20261011',applicationPublicIds:[app]}));
  assert.equal(outcome.error?.code,'SOP_NOT_LOCKED','new Case participates in Chat barrier');
  const final=await fixture();outcome=await race(final,async()=>{
   await writer.execute("UPDATE cases SET status='PASS' WHERE workspace_id=? AND chat_id=? AND id=?",final.keys);
   await writer.execute("INSERT INTO case_result_reviews(workspace_id,chat_id,case_id,plan_version,evidence_sha256,evidence_json,suggestion_json,actor_user_id,final_verdict,confirmed_by_user_id,confirmed_at) VALUES (?,?,?,1,?,'{}','{}',?,'PASS',?,UTC_TIMESTAMP())",[...final.keys,'0'.repeat(64),user.insertId,user.insertId]);
  },tx=>createChatLifecycleRepository({transaction:tx}).close(token,{chatPublicId:final.chatId,mode:'NORMAL'}));
  assert.equal(outcome.result?.status,'CLOSED','new human verdict visible after waiting');
  const run=await fixture();await writer.execute("UPDATE case_chats SET status='FORCE_CLOSED',close_reason='合成封存',closed_at=UTC_TIMESTAMP() WHERE workspace_id=? AND id=?",run.keys.slice(0,2));
  const input={chatPublicId:run.chatId,requestId:crypto.randomUUID(),reason:'合成新轮次',confirmPreserveFormalData:true};let first;
  outcome=await race(run,async()=>{first=await createChatLifecycleRepository({transaction:action=>action(writer)}).newRun(token,input);},tx=>createChatLifecycleRepository({transaction:tx}).newRun(token,input));
  assert.equal(outcome.result?.duplicate,true,'same request replays committed target');assert.equal(outcome.result.chatPublicId,first.chatPublicId);
 }finally{if(reader)await reader.end();if(writer)await writer.end();await root.query(`DROP DATABASE IF EXISTS ${database}`);await root.end();}
});
