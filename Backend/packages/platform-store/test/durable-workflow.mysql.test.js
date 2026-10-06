import {setTimeout as delay} from 'node:timers/promises';
import {createChatLifecycleRepository} from '../src/chat-lifecycle.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createCaseResultRepository} from '../src/case-result.js';
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
 const scopeDb=await pool.getConnection();const {keys:caseKeys}=await workflowScope(scopeDb,token,scope).finally(()=>scopeDb.release());
 const checksumSql='SELECT SHA2(saver_blob,256) AS checksum FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?';
 const [[beforeCrash]]=await pool.execute(checksumSql,caseKeys);
 const failedEvent={...scope,eventId:crypto.randomUUID(),expectedStage:'DISCUSSION'};
 const faultyPool={getConnection:async()=>{const db=await pool.getConnection();const execute=db.execute.bind(db);db.execute=async(sql,args)=>{if(sql.startsWith('INSERT INTO case_workflow_events'))throw Error('synthetic event persistence failure');return execute(sql,args);};const release=db.release.bind(db);db.release=()=>{db.execute=execute;release();};return db;}};
 await assert.rejects(createDurableWorkflowRepository({pool:faultyPool}).resume(token,failedEvent),/synthetic event persistence failure/);
 const [[afterCrash]]=await pool.execute(checksumSql,caseKeys);assert.equal(afterCrash.checksum,beforeCrash.checksum);
 assert.equal((await repo.resume(token,failedEvent)).replayed,undefined);
 assert.equal((await repo.read(token,scope)).stage,'CONFIRM_PLAN_DATA');
 await business.confirmSopProposal(...args,1,'DATA');assert.equal((await restarted.read(token,scope)).stage,'CONFIRM_EXPECTATIONS');
 const staleNotification={...scope,eventId:crypto.randomUUID(),expectedStage:'DISCUSSION'};
 const reconciled=await repo.resume(token,staleNotification);assert.equal(reconciled.stage,'CONFIRM_EXPECTATIONS');
 assert.equal((await restarted.resume(token,staleNotification)).replayed,true);
 await assert.rejects(repo.resume(token,{...staleNotification,expectedStage:'PREPARE_DATA'}),{code:'WORKFLOW_EVENT_CONFLICT'});
 await business.confirmSopProposal(...args,1,'EXPECTATIONS');assert.equal((await repo.read(token,scope)).stage,'PREPARE_DATA');
 await business.executeGeneratedData(...args,1,plan.contract.dataSpecification,(db,scope,specification)=>createDataGenerationGraph({db,scope,specification}).invoke({}));
 assert.equal((await repo.read(token,scope)).stage,'CONFIRM_DRAFT');
 await business.confirmGeneratedData(...args,0);const exchange=await restarted.read(token,scope);assert.equal(exchange.stage,'FILE_EXCHANGE');assert.equal(exchange.waiting[0].fileType,'03');

 const evidenceCase=await business.createCase(token,chat.publicId,'可选05及证据过期合成测试');
 const evidenceScope={chatPublicId:chat.publicId,casePublicId:evidenceCase.publicId},evidenceArgs=[token,chat.publicId,evidenceCase.publicId];
 const optionalPlan={objective:'独立05可选测试',preconditions:[],scenarios:[{title:'账户',setup:'已有账户',action:'只读核查',expected:'网点306',evidence:'正式账户'}],openQuestions:[],exchangePlan:{status:'READY',openQuestions:[],steps:[{stepId:'optional05',roundId:'optionalRound',direction:'RECEIVE',fileType:'05',businessTime:{kind:'DATE',value:'20261006'},required:false,dependsOn:[]}]}};
 optionalPlan.contract=planContract(optionalPlan);optionalPlan.contract.expectations=[{scenarioIndex:0,expectedQuote:'网点306',source:'FORMAL_ACCOUNT',selector:{accountIndex:null,transactionAccountId:'90000000000000001',channelId:null,fundCode:null,shareClass:null,fileType:null,businessDate:null},field:'branchCode',operator:'eq',expectedValue:'306'}];
 await business.saveSopProposal(...evidenceArgs,optionalPlan);await business.confirmSopProposal(...evidenceArgs,1,'DATA');await business.confirmSopProposal(...evidenceArgs,1,'EXPECTATIONS');
 await business.executeGeneratedData(...evidenceArgs,1,optionalPlan.contract.dataSpecification,(db,scope,specification)=>createDataGenerationGraph({db,scope,specification}).invoke({}));await business.confirmGeneratedData(...evidenceArgs,0);
 let evidenceState=await repo.read(token,evidenceScope);assert.equal(evidenceState.stage,'EVALUATE_RESULT');assert.equal(evidenceState.optionalActions[0].fileType,'05');
 const resultsRepo=createCaseResultRepository({transaction});let snapshot=await resultsRepo.snapshot(token,evidenceScope);
 // Synthetic review metadata tests workflow freshness; this is not a model verdict or business acceptance.
 await resultsRepo.save(token,evidenceScope,{snapshot,phase:'AWAITING_CONFIRMATION',suggestion:{outcome:'PASS'}});
 assert.equal((await repo.read(token,evidenceScope)).stage,'CONFIRM_RESULT');
 await pool.execute("UPDATE case_sop_versions v JOIN cases k ON k.workspace_id=v.workspace_id AND k.chat_id=v.chat_id AND k.id=v.case_id SET v.plan_json=JSON_SET(v.plan_json,'$.preconditions',JSON_ARRAY('合成规则变更')) WHERE k.public_id=?",[evidenceCase.publicId]);
 assert.equal((await restarted.read(token,evidenceScope)).stage,'EVALUATE_RESULT');
 snapshot=await resultsRepo.snapshot(token,evidenceScope);await resultsRepo.save(token,evidenceScope,{snapshot,phase:'AWAITING_CONFIRMATION',suggestion:{outcome:'REVIEW'}});assert.equal((await repo.read(token,evidenceScope)).stage,'EVALUATE_RESULT');
 const lockDb=await pool.getConnection();
 try {
 const {keys}=await workflowScope(lockDb,token,scope);const name='case-workflow:'+crypto.createHash('sha256').update(keys.join(':')).digest('hex').slice(0,48);
 await lockDb.execute('SELECT GET_LOCK(?,0)',[name]);
 await assert.rejects(createDurableWorkflowRepository({pool,lockTimeout:0}).read(token,scope),{code:'WORKFLOW_BUSY'});
 await lockDb.execute('SELECT RELEASE_LOCK(?)',[name]);
 assert.equal((await repo.read(token,scope)).stage,'FILE_EXCHANGE');
 // Holding the same Chat/Case locks used by workflow persistence serializes force closure.
 await lockDb.beginTransaction();await workflowScope(lockDb,token,scope,true);
 let closeSettled=false;
 const closing=createChatLifecycleRepository({transaction}).close(token,{chatPublicId:chat.publicId,mode:'FORCE',reason:'合成并发封存'}).finally(()=>{closeSettled=true;});
 await delay(100);assert.equal(closeSettled,false);
 await lockDb.rollback();assert.equal((await closing).status,'FORCE_CLOSED');
 const [[before]]=await lockDb.execute('SELECT HEX(saver_blob) AS snapshotHex FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);
 assert.equal((await repo.read(token,scope)).stage,'CHAT_CLOSED');
 await assert.rejects(repo.resume(token,{...scope,eventId:crypto.randomUUID(),expectedStage:'FILE_EXCHANGE'}),{code:'CHAT_CLOSED'});
 await assert.rejects(repo.resume(token,event),{code:'CHAT_CLOSED'});
 const [[after]]=await lockDb.execute('SELECT HEX(saver_blob) AS snapshotHex FROM case_workflow_checkpoints WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);assert.equal(after.snapshotHex,before.snapshotHex);
 await lockDb.execute('UPDATE platform_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE token_hash=?',[sessionTokenHash(token)]);
 await assert.rejects(repo.read(token,scope),{code:'UNAUTHENTICATED'});
 }finally{lockDb.release();}
 }finally{await pool.end();}
});
