import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';

test('MySQL rename persists titles, preserves lifecycle and rejects foreign project/workspace scope', {skip:process.env.CASE_RENAME_MYSQL!=='1'},async()=>{
  const db=await mysql.createConnection(migrationConfig());
  try{
    await db.beginTransaction();
    async function identity(){
      const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
      const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'改名合成验收')",[id,id+'@example.invalid','synthetic']);
      await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
      await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
      return token;
    }
    const token=await identity(),foreign=await identity(),repo=createCaseRepository({transaction:action=>action(db)});
    const chat=await repo.createChat(token,'原项目'),other=await repo.createChat(token,'另一个项目'),item=await repo.createCase(token,chat.publicId,'原Case');
    await repo.renameChat(token,chat.publicId,' 项目新名称 ');
    await repo.renameCase(token,chat.publicId,item.publicId,' Case新名称 ');
    assert.equal((await repo.listChats(token)).chats.find(c=>c.public_id===chat.publicId).title,'项目新名称');
    assert.equal((await repo.listCases(token,chat.publicId)).cases[0].title,'Case新名称');
    await assert.rejects(repo.renameChat(foreign,chat.publicId,'越权'),{code:'CHAT_NOT_FOUND'});
    await assert.rejects(repo.renameCase(foreign,chat.publicId,item.publicId,'越权'),{code:'CASE_NOT_FOUND'});
    await assert.rejects(repo.renameCase(token,other.publicId,item.publicId,'错项目'),{code:'CASE_NOT_FOUND'});
    const [[before]]=await db.execute('SELECT status,(SELECT COUNT(*) FROM case_state_events WHERE case_id=cases.id) AS events FROM cases WHERE public_id=?',[item.publicId]);
    await repo.renameCase(token,chat.publicId,item.publicId,'名'.repeat(160));
    const [[after]]=await db.execute('SELECT status,(SELECT COUNT(*) FROM case_state_events WHERE case_id=cases.id) AS events FROM cases WHERE public_id=?',[item.publicId]);
    assert.deepEqual(before,after);
    await assert.rejects(repo.renameCase(token,chat.publicId,item.publicId,'名'.repeat(161)),{code:'INVALID_TITLE'});
    assert.equal((await repo.listCases(token,chat.publicId)).cases[0].title,'名'.repeat(160));
  }finally{await db.rollback();await db.end();}
});
