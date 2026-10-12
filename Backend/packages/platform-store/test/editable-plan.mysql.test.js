import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';

test('MySQL: editable plan carries only unchanged data approval and prepares exact authorized data without a third click',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());
 try {
  await db.beginTransaction();
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成验收')",[id,id+'@example.invalid','synthetic']);
  const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  let n=0;
  const transaction=async action=>{const name='editable_'+ ++n;await db.query('SAVEPOINT '+name);try{return await action(db);}catch(e){try{await db.query('ROLLBACK TO SAVEPOINT '+name);}catch{}throw e;}};
  const repo=createCaseRepository({transaction});
  const chat=await repo.createChat(token,'持续修改验收'),item=await repo.createCase(token,chat.publicId,'合成Case');
  const args=[token,chat.publicId,item.publicId];
  const plan={objective:'申购结果核对',preconditions:[],scenarios:[{title:'申购',setup:'合成输入',action:'申购100元',expected:'状态CONFIRMED',evidence:'TA回传'}],openQuestions:[],exchangePlan};
  plan.contract=planContract(plan);
  await repo.saveSopProposal(...args,plan);
  await repo.confirmSopProposal(...args,1,'DATA');
  const firstApproval=(await repo.getLatestSopProposal(...args)).confirmations[0];
  const expectedEdit=structuredClone(plan);expectedEdit.scenarios[0].expected+='，核对业务说明';
  await repo.saveSopProposal(...args,expectedEdit,{expectedVersion:1});
  const carried=await repo.getLatestSopProposal(...args);
  assert.deepEqual(carried.confirmations.map(c=>c.section),['DATA']);
  assert.equal(String(carried.confirmations[0].confirmedAt),String(firstApproval.confirmedAt));
  await assert.rejects(repo.confirmSopProposal(...args,1,'EXPECTATIONS'),{code:'STALE_PLAN'});
  const amountEdit=structuredClone(expectedEdit);amountEdit.contract.applications[0].fields.ApplicationAmount='200.00';
  await repo.saveSopProposal(...args,amountEdit,{expectedVersion:2});
  assert.deepEqual((await repo.getLatestSopProposal(...args)).confirmations,[]);
  await assert.rejects(repo.confirmSopProposal(...args,3,'EXPECTATIONS'),{code:'PLAN_DATA_CONFIRMATION_REQUIRED'});
  await repo.confirmSopProposal(...args,3,'DATA');

  await repo.beginCaseDiscussionTurn(...args,{expectedRevision:0,userInput:'修改预期说明',kind:'PROPOSE_PLAN'});
  const {contract,...base}=amountEdit;
  await repo.checkpointCasePlanProposal(...args,{turnNumber:1,assistantReply:'已有方案',promptVersion:'plan-review-draft-v1',proposal:base});
  assert.equal((await repo.getLatestSopProposal(...args)).status,'DRAFT');
  await assert.rejects(repo.confirmSopProposal(...args,4,'DATA'),{code:'INVALID_CASE_STATE'});
  await repo.finishCasePlanProposal(...args,{turnNumber:1,assistantReply:'测试方案',promptVersion:'plan-confirmed-contract-v2',proposal:amountEdit});
  assert.deepEqual((await repo.getLatestSopProposal(...args)).confirmations.map(c=>c.section),['DATA']);
  await repo.confirmSopProposal(...args,4,'EXPECTATIONS');
  assert.equal((await repo.getLatestSopProposal(...args)).dataApprovalMode,'PLAN_CONFIRMED');
  const specification=amountEdit.contract.dataSpecification;
  await repo.executeGeneratedData(...args,4,specification,(db,scope,spec)=>createDataGenerationGraph({db,scope,specification:spec}).invoke({}));
  const generated=await repo.generatedData(...args);
  await assert.rejects(repo.confirmGeneratedData(...args,generated.revision,{planVersionNumber:3}),{code:'PLAN_DATA_MISMATCH'});
  await db.execute('UPDATE case_generated_customers SET simulated_balance=999.99 WHERE workspace_id=?',[workspace.insertId]);
  await assert.rejects(repo.confirmGeneratedData(...args,generated.revision,{planVersionNumber:4}),{code:'PLAN_DATA_MISMATCH'});
  await assert.rejects(repo.confirmGeneratedData(...args,generated.revision),{code:'PLAN_DATA_MISMATCH'});
  await db.execute('UPDATE case_generated_customers SET simulated_balance=1000.00 WHERE workspace_id=?',[workspace.insertId]);
  const ready=await repo.confirmGeneratedData(...args,generated.revision,{planVersionNumber:4});
  assert.equal(ready.reviewStatus,'CONFIRMED');assert.equal(ready.businessApplied,false);
  assert.equal((await repo.confirmGeneratedData(...args,generated.revision,{planVersionNumber:4})).reviewStatus,'CONFIRMED');
  await assert.rejects(repo.confirmGeneratedData(...args,generated.revision),{code:'DATA_ALREADY_CONFIRMED'});
  const [[formal]]=await db.execute('SELECT COUNT(*) AS n FROM sales_confirmed_accounts WHERE workspace_id=?',[workspace.insertId]);assert.equal(Number(formal.n),0);
  const [[event]]=await db.execute("SELECT COUNT(*) AS n FROM case_state_events WHERE workspace_id=? AND reason='CONFIRMED_PLAN_DATA_PREPARED'",[workspace.insertId]);assert.equal(Number(event.n),1);

  const legacy=await repo.createCase(token,chat.publicId,'历史流程'),legacyArgs=[token,chat.publicId,legacy.publicId];
  await repo.saveSopProposal(...legacyArgs,plan);await repo.confirmSopProposal(...legacyArgs,1,'DATA');await repo.confirmSopProposal(...legacyArgs,1,'EXPECTATIONS');
  await db.execute('DELETE FROM case_plan_data_authorizations WHERE workspace_id=? AND case_id=(SELECT id FROM cases WHERE public_id=?)',[workspace.insertId,legacy.publicId]);
  assert.equal((await repo.getLatestSopProposal(...legacyArgs)).dataApprovalMode,undefined);
  await repo.executeGeneratedData(...legacyArgs,1,plan.contract.dataSpecification,(db,scope,spec)=>createDataGenerationGraph({db,scope,specification:spec}).invoke({}));
  await assert.rejects(repo.confirmGeneratedData(...legacyArgs,0,{planVersionNumber:1}),{code:'PLAN_DATA_MISMATCH'});
  assert.equal((await repo.confirmGeneratedData(...legacyArgs,0)).reviewStatus,'CONFIRMED');
 } finally {await db.rollback();await db.end();}
});
