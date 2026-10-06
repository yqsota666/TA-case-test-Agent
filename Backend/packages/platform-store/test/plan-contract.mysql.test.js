import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {planContract} from '../../case-agent/test/plan-contract-fixture.js';
import {exchangePlan} from '../../case-agent/test/exchange-plan-fixture.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';

test('MySQL: same-version dual confirmation freezes drafts, survives retries and never applies formal data',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());
 try{
  await db.beginTransaction();
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  const [user]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'Plan测试')`,[id,id+'@example.invalid','synthetic']);
  await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  let n=0;
  const transaction=async action=>{const name='plan_'+ ++n;await db.query('SAVEPOINT '+name);try{return await action(db);}catch(e){await db.query('ROLLBACK TO SAVEPOINT '+name);throw e;}};
  const repo=createCaseRepository({transaction});
  const chat=await repo.createChat(token,'双确认测试'),item=await repo.createCase(token,chat.publicId,'测试Case');
  const args=[token,chat.publicId,item.publicId];
  const plan={objective:'申购结果验证',preconditions:[],scenarios:[{title:'申购',setup:'合成客户',action:'申购100元',expected:'状态CONFIRMED',evidence:'TA确认'}],openQuestions:[],exchangePlan};
  plan.contract=planContract(plan);
  await repo.saveSopProposal(...args,plan);
  await assert.rejects(repo.confirmSopProposal(...args,1,'EXPECTATIONS'),{code:'PLAN_DATA_CONFIRMATION_REQUIRED'});
  await repo.confirmSopProposal(...args,1,'DATA');
  await repo.confirmSopProposal(...args,1,'DATA');
  assert.deepEqual((await repo.getLatestSopProposal(...args)).confirmations.map(c=>c.section),['DATA']);
  const before=await repo.generatedData(...args);assert.equal(before.status,'NOT_STARTED');
  const changed=structuredClone(plan);changed.contract.dataSpecification.customers[0].simulatedBalance='2000.00';
  await repo.saveSopProposal(...args,changed);
  await assert.rejects(repo.confirmSopProposal(...args,1,'EXPECTATIONS'),{code:'STALE_PLAN'});
  assert.deepEqual((await repo.getLatestSopProposal(...args)).confirmations,[]);
  await assert.rejects(repo.confirmSopProposal(...args,2,'EXPECTATIONS'),{code:'PLAN_DATA_CONFIRMATION_REQUIRED'});
  await repo.confirmSopProposal(...args,2,'DATA');
  await repo.confirmSopProposal(...args,2,'EXPECTATIONS');
  const spec=changed.contract.dataSpecification;
  await assert.rejects(repo.executeGeneratedData(...args,2,plan.contract.dataSpecification,()=>{}),{code:'PLAN_DATA_MISMATCH'});
  const run=(db,scope,specification)=>createDataGenerationGraph({db,scope,specification}).invoke({});
  await repo.executeGeneratedData(...args,2,spec,run);
  assert.equal((await repo.executeGeneratedData(...args,2,spec,run)).replayed,true);
  const generated=await repo.generatedData(...args);
  assert.equal(generated.customers[0].simulated_balance,'2000.00');
  assert.equal(generated.planDataFrozen,true);
  await assert.rejects(repo.editGeneratedData(...args,{revision:0,changes:{customers:[],accounts:[],funds:[],holdings:[]}}),{code:'PLAN_DATA_FROZEN'});
  await repo.confirmGeneratedData(...args,0);
  const [[formal]]=await db.execute('SELECT COUNT(*) AS n FROM sales_confirmed_accounts');assert.equal(Number(formal.n),0);
  const [[holds]]=await db.execute('SELECT COUNT(*) AS n FROM sales_confirmed_holdings');assert.equal(Number(holds.n),0);
  await assert.rejects(repo.saveSopProposal(...args,plan),{code:'INVALID_CASE_STATE'});
  const foreign=await repo.createChat(token,'另一Chat');
  await assert.rejects(repo.getLatestSopProposal(token,foreign.publicId,item.publicId),{code:'CASE_NOT_FOUND'});
 }finally{await db.rollback();await db.end();}
});
