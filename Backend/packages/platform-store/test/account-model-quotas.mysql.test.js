import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';
import mysql from 'mysql2/promise';import {migrationConfig} from '../src/migrate.js';import {sessionTokenHash} from '../src/index.js';
import {createAccountModelQuotas} from '../src/account-model-quotas.js';import {createModelConsumptionRepository,modelBudgetConfig} from '../src/model-consumption.js';
test('account quotas enforce private settings, retain consumed balances and exempt only the demo from daily budgets',{skip:process.env.CASE_ACCOUNT_QUOTA_MYSQL!=='1'},async()=>{
 const pool=mysql.createPool({...migrationConfig(),connectionLimit:8});const transaction=async f=>{const db=await pool.getConnection();try{await db.beginTransaction();const v=await f(db);await db.commit();return v;}catch(e){await db.rollback();throw e;}finally{db.release();}};
 async function owner(demo=false){const id=randomUUID(),token=randomBytes(32).toString('base64url');let userId;await transaction(async db=>{const [r]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成额度账户')",[id,id+'@example.invalid','synthetic']);userId=r.insertId;if(demo)await db.execute('INSERT INTO account_demo_users(user_id) VALUES (?)',[userId]);await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[randomUUID(),userId]);await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),userId]);});return {id,token,userId};}
 try{const normal=await owner(),other=await owner(),demo=await owner(true);const quotas=createAccountModelQuotas({transaction,defaultDaily:50});
 await pool.execute('INSERT INTO account_model_quotas(user_id,daily_tokens) VALUES (?,100)',[normal.userId]);assert.equal((await quotas.usage(normal.token)).dailyTokens,100);assert.equal((await quotas.usage(other.token)).dailyTokens,50);
 const config=modelBudgetConfig({MODEL_USER_DAILY_TOKENS:'50',MODEL_WORKSPACE_DAILY_TOKENS:'150',MODEL_GLOBAL_DAILY_TOKENS:'1000000'}),consumption=createModelConsumptionRepository({transaction,config});
 const call={model:'synthetic-quota',purpose:'discussion',reservedTokens:60};const a=await consumption.reserve(normal.token,call);await consumption.settle(a.id,{prompt_tokens:40,completion_tokens:10});
 const b=await consumption.reserve(demo.token,{...call,reservedTokens:1000});await consumption.settle(b.id,{prompt_tokens:1000,completion_tokens:100});
 const d=await consumption.reserve(demo.token,{...call,reservedTokens:1000});await consumption.settle(d.id,null);
 const unlimited=await quotas.usage(demo.token);assert.equal(unlimited.unlimited,true);assert.equal(unlimited.remainingTokens,null);assert.equal(unlimited.usedTokens,1100);assert.equal(unlimited.uncertainTokens,1000);
 const c=await consumption.reserve(normal.token,{...call,reservedTokens:50});await consumption.settle(c.id,{prompt_tokens:30,completion_tokens:20});await assert.rejects(consumption.reserve(normal.token,{...call,reservedTokens:1}),{code:'MODEL_BUDGET_EXHAUSTED'});
 await pool.execute('UPDATE account_model_quotas SET daily_tokens=80 WHERE user_id=?',[normal.userId]);assert.equal((await quotas.usage(normal.token)).remainingTokens,0);await assert.rejects(consumption.reserve(normal.token,{...call,reservedTokens:1}),{code:'MODEL_BUDGET_EXHAUSTED'});
 assert.equal((await quotas.usage(other.token)).usedTokens,0);assert.equal((await quotas.usage(other.token)).records.length,0);
 }finally{await pool.end();}
});
