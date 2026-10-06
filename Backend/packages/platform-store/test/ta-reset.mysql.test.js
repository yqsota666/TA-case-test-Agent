import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createTaResetRepository} from '../src/ta-reset.js';

test('MySQL: reset reads committed epochs and duplicate requests after waiting for locks',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig()),worker=await mysql.createConnection(migrationConfig());
 let userId,workspaceId;
 try{
  const token=crypto.randomBytes(32).toString('base64url'),suffix=crypto.randomUUID();
  const [user]=await db.execute('INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,?)',[suffix,suffix+'@example.invalid','synthetic','reset concurrency']);userId=user.insertId;
  const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),userId]);workspaceId=workspace.insertId;
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[crypto.createHash('sha256').update(token).digest('hex'),userId]);
  const [channel]=await db.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'synthetic','synthetic','27','306','22')",[workspaceId]);
  const [chat]=await db.execute("INSERT INTO case_chats(public_id,workspace_id,title,status,closed_at) VALUES (?,?,'reset race','CLOSED',NOW())",[crypto.randomUUID(),workspaceId]);
  let waiting;
  const repo=createTaResetRepository({transaction:async action=>{
   await worker.beginTransaction();
   try{const result=await action({execute:async(sql,values)=>{
    if(sql.startsWith('SELECT id,status FROM case_chats'))waiting();
    return worker.execute(sql,values);
   }});await worker.commit();return result;}catch(error){await worker.rollback();throw error;}
  }});
  async function race({epoch,duplicate}){
   const requestId=crypto.randomUUID(),insertId=duplicate?requestId:crypto.randomUUID();
   await db.beginTransaction();
   await db.execute('SELECT id FROM case_chats WHERE id=? FOR UPDATE',[chat.insertId]);
   const locked=new Promise(resolve=>{waiting=resolve;});
   const pending=repo.confirm(token,{channelId:String(channel.insertId),requestId,reason:'synthetic reset',confirmation:'TA_RESET_CONFIRMED'});
   await Promise.race([locked,pending]);
   // Authentication has already established a snapshot; this event commits while the reset is waiting.
   await db.execute('INSERT INTO ta_reset_events(workspace_id,channel_id,epoch,account_id_cutoff,request_id,reason,actor_user_id) VALUES (?,?,?,0,?,?,?)',[workspaceId,channel.insertId,epoch,insertId,'synthetic reset',userId]);
   await db.commit();
   const result=await pending;
   assert.equal(result.epoch,duplicate?epoch:epoch+1);assert.equal(result.duplicate,duplicate);
  }
  await race({epoch:1,duplicate:true});
  await race({epoch:2,duplicate:false});
  const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM ta_reset_events WHERE workspace_id=?',[workspaceId]);assert.equal(Number(count.n),3);
 }finally{
  await worker.rollback();await db.rollback();
  if(workspaceId){await db.execute('DELETE FROM ta_reset_events WHERE workspace_id=?',[workspaceId]);await db.execute('DELETE FROM case_chats WHERE workspace_id=?',[workspaceId]);await db.execute('DELETE FROM exchange_channels WHERE workspace_id=?',[workspaceId]);await db.execute('DELETE FROM workspaces WHERE id=?',[workspaceId]);}
  if(userId){await db.execute('DELETE FROM platform_sessions WHERE user_id=?',[userId]);await db.execute('DELETE FROM platform_users WHERE id=?',[userId]);}
  await worker.end();await db.end();
 }
});
