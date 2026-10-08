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
 }finally{await pool.end();}
});
