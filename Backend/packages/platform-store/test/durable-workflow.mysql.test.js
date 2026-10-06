import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createDurableWorkflowRepository,workflowScope} from '../src/durable-workflow.js';

test('MySQL durable workflow: restart, multi-instance event replay, rollback, isolation, expiry and lock timeout',
 {skip:process.env.CASE_WORKFLOW_MYSQL!=='1'},async()=>{
 const pool=mysql.createPool({...migrationConfig(),connectionLimit:6});
 const transaction=async action=>{const db=await pool.getConnection();try{await db.beginTransaction();const r=await action(db);await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}};
 const business=createCaseRepository({transaction});
 const owner=async()=>{const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();await transaction(async db=>{
 const [user]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成编排测试')`,[id,id+'@example.invalid','synthetic']);
 await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
 await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);});return token;};
 try {
 const token=await owner(),foreign=await owner();
 const chat=await business.createChat(token,'编排合成测试'),item=await business.createCase(token,chat.publicId,'合成Case');
 const scope={chatPublicId:chat.publicId,casePublicId:item.publicId};
 const repo=createDurableWorkflowRepository({pool});const first=await repo.read(token,scope);
 assert.equal(first.stage,'DISCUSSION');assert.equal(first.interrupted,true);
 const restarted=createDurableWorkflowRepository({pool});assert.deepEqual(await restarted.read(token,scope),first);
 const event={...scope,eventId:crypto.randomUUID(),expectedStage:'DISCUSSION'};
 const results=await Promise.all([repo.resume(token,event),restarted.resume(token,event)]);
 assert.equal(results.filter(r=>r.replayed).length,1);
 assert.equal(results[0].checkpointId,results[1].checkpointId);
 await assert.rejects(repo.resume(token,{...event,expectedStage:'CONFIRM_RESULT'}),{code:'WORKFLOW_EVENT_CONFLICT'});
 await assert.rejects(repo.read(foreign,scope),{code:'CASE_NOT_FOUND'});
 const other=await business.createChat(token,'另一Chat');await assert.rejects(repo.read(token,{...scope,chatPublicId:other.publicId}),{code:'CASE_NOT_FOUND'});
 const plan={objective:'申购结果验证',preconditions:[],scenarios:[{title:'申购',setup:'合成客户',action:'申购100元',expected:'状态CONFIRMED',evidence:'TA确认'}],openQuestions:[],exchangePlan};plan.contract=planContract(plan);
 const args=[token,chat.publicId,item.publicId];await business.saveSopProposal(...args,plan);
 // Simulate a crash between graph persistence and event-response persistence.
 const [[beforeCrash]]=await pool.execute('SELECT SHA2(saver_blob,256) AS checksum FROM case_workflow_checkpoints');
 const failedEvent={...scope,eventId:crypto.randomUUID(),expectedStage:'DISCUSSION'};
 const faultyPool={getConnection:async()=>{const db=await pool.getConnection();const execute=db.execute.bind(db);db.execute=async(sql,args)=>{if(sql.startsWith('INSERT INTO case_workflow_events'))throw Error('synthetic event persistence failure');return execute(sql,args);};const release=db.release.bind(db);db.release=()=>{db.execute=execute;release();};return db;}};
 await assert.rejects(createDurableWorkflowRepository({pool:faultyPool}).resume(token,failedEvent),/synthetic event persistence failure/);
 const [[afterCrash]]=await pool.execute('SELECT SHA2(saver_blob,256) AS checksum FROM case_workflow_checkpoints');assert.equal(afterCrash.checksum,beforeCrash.checksum);
 assert.equal((await repo.resume(token,failedEvent)).replayed,undefined);
 assert.equal((await repo.read(token,scope)).stage,'CONFIRM_PLAN_DATA');
 await business.confirmSopProposal(...args,1,'DATA');assert.equal((await restarted.read(token,scope)).stage,'CONFIRM_EXPECTATIONS');
 await business.confirmSopProposal(...args,1,'EXPECTATIONS');assert.equal((await repo.read(token,scope)).stage,'PREPARE_DATA');
 await business.executeGeneratedData(...args,1,plan.contract.dataSpecification,(db,scope,specification)=>createDataGenerationGraph({db,scope,specification}).invoke({}));
 assert.equal((await repo.read(token,scope)).stage,'CONFIRM_DRAFT');
 await business.confirmGeneratedData(...args,0);const exchange=await restarted.read(token,scope);assert.equal(exchange.stage,'FILE_EXCHANGE');assert.equal(exchange.waiting[0].fileType,'03');

 const lockDb=await pool.getConnection();
 try {
 const {keys}=await workflowScope(lockDb,token,scope);const name='case-workflow:'+crypto.createHash('sha256').update(keys.join(':')).digest('hex').slice(0,48);
 await lockDb.execute('SELECT GET_LOCK(?,0)',[name]);
 await assert.rejects(createDurableWorkflowRepository({pool,lockTimeout:0}).read(token,scope),{code:'WORKFLOW_BUSY'});
 await lockDb.execute('SELECT RELEASE_LOCK(?)',[name]);
 assert.equal((await repo.read(token,scope)).stage,'FILE_EXCHANGE');
 await lockDb.execute("UPDATE case_chats SET status='CLOSED',closed_at=CURRENT_TIMESTAMP(3) WHERE public_id=?",[chat.publicId]);
 const [[before]]=await lockDb.execute('SELECT HEX(saver_blob) AS snapshotHex FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);
 assert.equal((await repo.read(token,scope)).stage,'CHAT_CLOSED');
 await assert.rejects(repo.resume(token,{...scope,eventId:crypto.randomUUID(),expectedStage:'FILE_EXCHANGE'}),{code:'CHAT_CLOSED'});
 const [[after]]=await lockDb.execute('SELECT HEX(saver_blob) AS snapshotHex FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);assert.equal(after.snapshotHex,before.snapshotHex);
 await lockDb.execute('UPDATE platform_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE token_hash=?',[sessionTokenHash(token)]);
 await assert.rejects(repo.read(token,scope),{code:'UNAUTHENTICATED'});
 }finally{lockDb.release();}
 }finally{await pool.end();}
});
