import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createCaseResultRepository} from '../src/case-result.js';
import {createCaseResultService} from '../../case-api/src/case-result.js';
test('MySQL business result: scoped append, retry, hashes, concurrent changes and explicit final verdict', {skip:process.env.CASE_BUSINESS_RESULT_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());
 try{
  await db.beginTransaction();let n=0;
  const transaction=async work=>{const sp='business_'+ ++n;await db.query('SAVEPOINT '+sp);try{return await work(db);}catch(e){await db.query('ROLLBACK TO SAVEPOINT '+sp);throw e;}};
  const owner=async()=>{
   const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
   const [u]=await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'核对测试')`,[id,id+'@example.invalid','synthetic']);
   await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),u.insertId]);
   await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),u.insertId]);return token;
  };
  const token=await owner(),other=await owner(),repo=createCaseRepository({transaction});
  const chat=await repo.createChat(token,'业务输出核对'),item=await repo.createCase(token,chat.publicId,'通用字段变化');
  const scope={chatPublicId:chat.publicId,casePublicId:item.publicId};
  const plan={objective:'核对用户业务输出',preconditions:[],openQuestions:[],scenarios:[{title:'字段变化',setup:'已有条件',action:'执行用户业务动作',expected:'字段变化后输出关闭',evidence:'用户结果原文'}],exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]},contract:{version:2,protocolVersion:'22',dataSpecification:{customers:[],accounts:[],funds:[],holdings:[],missing:[]},assumptions:[],applications:[],expectations:[],missing:[],businessExpectations:[{scenarioIndex:0,expectedQuote:'字段变化后输出关闭'}]}};
  await repo.saveSopProposal(token,chat.publicId,item.publicId,plan);await repo.confirmSopProposal(token,chat.publicId,item.publicId,1,'DATA');await repo.confirmSopProposal(token,chat.publicId,item.publicId,1,'EXPECTATIONS');
  const result=createCaseResultRepository({transaction});
  await assert.rejects(result.readBusinessOutput(other,scope),{code:'CASE_NOT_FOUND'});
  const input={...scope,requestId:crypto.randomUUID(),planVersion:1,sourceKind:'SYNTHETIC_TEST',content:'合成演练结果：字段变化后输出关闭'};
  await assert.rejects(result.saveBusinessOutput(other,input),{code:'CASE_NOT_FOUND'});
  await assert.rejects(result.saveBusinessOutput(token,{...input,planVersion:2}),{code:'PLAN_NOT_CONFIRMED'});
  const first=await result.saveBusinessOutput(token,input);assert.equal(first.duplicate,false);assert.equal(first.businessOutput.sha256,crypto.createHash('sha256').update(input.content).digest('hex'));
  assert.equal((await result.saveBusinessOutput(token,input)).duplicate,true);
  await assert.rejects(result.saveBusinessOutput(token,{...input,content:'不同结果'}),{code:'BUSINESS_OUTPUT_CONFLICT'});
  const complete=async request=>{const output=JSON.parse(request.user).result;return JSON.stringify({checks:[{scenarioIndex:0,expectedQuote:plan.scenarios[0].expected,evidenceId:output.evidenceId,resultQuote:output.content,verdict:'MATCH',explanation:'已提供实际结果对应'}],uncertainties:[]});};
  const service=createCaseResultService({repository:result,complete});
  const review=await service.evaluate(token,scope);assert.equal(review.suggestion.outcome,'PASS');
  await result.saveBusinessOutput(token,{...input,requestId:crypto.randomUUID(),content:'第二次合成演练：字段变化后输出关闭'});
  await assert.rejects(result.confirm(token,{...scope,reviewId:review.reviewId,verdict:'PASS',reason:'旧证据'}),{code:'CASE_RESULT_CHANGED'});
  const racing=createCaseResultService({repository:result,complete:async request=>{await result.saveBusinessOutput(token,{...input,requestId:crypto.randomUUID(),content:'处理期间新结果：字段变化后输出关闭'});return complete(request);}});
  await assert.rejects(racing.evaluate(token,scope),{code:'CASE_RESULT_CHANGED'});
  const latest=await service.evaluate(token,scope);
  await assert.rejects(result.confirm(other,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'外部账户'}),{code:'CASE_NOT_FOUND'});
  assert.equal((await result.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'人工核对合成演练结果'})).finalVerdict,'PASS');
  assert.equal((await result.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'重复确认'})).duplicate,true);
  await assert.rejects(result.saveBusinessOutput(token,{...input,requestId:crypto.randomUUID()}),{code:'CASE_NOT_WRITABLE'});
 }finally{await db.rollback();await db.end();}
});
