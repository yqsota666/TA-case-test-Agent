import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {sessionTokenHash} from '../src/index.js';
import {createModelConsumptionRepository,modelBudgetConfig} from '../src/model-consumption.js';

test('MySQL budgets serialize parallel claims, isolate owners, survive timeout and settle once',
  {skip:process.env.CASE_BUDGET_MYSQL!=='1'},async()=>{
  const pool=mysql.createPool({...migrationConfig(),connectionLimit:8});
  const transaction=async action=>{
    const db=await pool.getConnection();
    try{await db.beginTransaction();const value=await action(db);await db.commit();return value;}
    catch(error){await db.rollback();throw error;}finally{db.release();}
  };
  const owner=async()=>{
    const token=randomBytes(32).toString('base64url'),id=randomUUID();
    await transaction(async db=>{
      const [user]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成额度测试')`,[id,id+'@example.invalid','synthetic']);
      await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[randomUUID(),user.insertId]);
      await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
    });return token;
  };
  try{
    const token=await owner(),other=await owner();
    const config=modelBudgetConfig({MODEL_USER_DAILY_TOKENS:'100',MODEL_WORKSPACE_DAILY_TOKENS:'200',MODEL_GLOBAL_DAILY_TOKENS:'1000000'});
    const a=createModelConsumptionRepository({transaction,config}),b=createModelConsumptionRepository({transaction,config});
    const input={model:'synthetic-flash',purpose:'test',reservedTokens:60};
    const claims=await Promise.allSettled([a.reserve(token,input),b.reserve(token,input),a.reserve(token,input)]);
    assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);
    assert.ok(claims.filter(c=>c.status==='rejected').every(c=>c.reason.code==='MODEL_BUDGET_EXHAUSTED'));
    const id=claims.find(c=>c.status==='fulfilled').value.id;
    const settlements=await Promise.all([a.settle(id,{prompt_tokens:6,completion_tokens:4}),b.settle(id,{prompt_tokens:6,completion_tokens:4})]);
    assert.equal(settlements.filter(s=>s.replayed).length,1);
    const next=await a.reserve(token,{...input,reservedTokens:90});
    await a.settle(next.id,null);
    await assert.rejects(a.reserve(token,{...input,reservedTokens:1}),{code:'MODEL_BUDGET_EXHAUSTED'});
    const independent=await b.reserve(other,input);await b.settle(independent.id,{prompt_tokens:10,completion_tokens:10});
    const [[row]]=await pool.execute('SELECT status,charged_tokens,input_tokens FROM model_consumption WHERE id=?',[next.id]);
    assert.equal(row.status,'UNCERTAIN');assert.equal(Number(row.charged_tokens),90);assert.equal(row.input_tokens,null);
    const third=await owner();
    const serial=createModelConsumptionRepository({transaction,config:{...config,userConcurrent:1}});
    const parallel=await Promise.allSettled([serial.reserve(third,{...input,reservedTokens:1}),serial.reserve(third,{...input,reservedTokens:1})]);
    assert.equal(parallel.filter(c=>c.status==='fulfilled').length,1);
    assert.equal(parallel.find(c=>c.status==='rejected').reason.code,'MODEL_CONCURRENCY_LIMIT');
    await serial.settle(parallel.find(c=>c.status==='fulfilled').value.id,{prompt_tokens:1,completion_tokens:0});
    const limited=createModelConsumptionRepository({transaction,config:{...config,userPerMinute:1}});
    await assert.rejects(limited.reserve(third,{...input,reservedTokens:1}),{code:'MODEL_RATE_LIMIT'});
    const [[count]]=await pool.execute("SELECT COUNT(*) AS n FROM model_consumption WHERE model='synthetic-flash'");
    assert.ok(Number(count.n)>=3);
  }finally{await pool.end();}
});
