import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelConsumptionRepository,modelBudgetConfig,normalizeModelUsage} from '../src/model-consumption.js';

test('provider usage includes all reported tokens and invalid/absent usage is unknown',()=>{
  assert.deepEqual(normalizeModelUsage({prompt_tokens:10,completion_tokens:5,total_tokens:20}),{input:10,output:5,total:20});
  for(const value of [undefined,{}, {prompt_tokens:10,completion_tokens:-1},{prompt_tokens:10,completion_tokens:5,total_tokens:14}])assert.equal(normalizeModelUsage(value),null);
  assert.throws(()=>modelBudgetConfig({MODEL_USER_DAILY_TOKENS:'0'}));
});

function fixture({booked=0,activity={},status='RESERVED'}={}) {
  const calls=[];
  const db={execute:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('FROM platform_sessions'))return [[{user_id:7,workspace_id:31}]];
    if(sql.includes('AS budget_day'))return [[{budget_day:'2026-10-08'}]];
    if(sql.includes('FROM model_budget_buckets'))return [[{booked_tokens:booked}]];
    if(sql.includes('SELECT workspace_id,user_id,status'))return [Array.from({length:activity.user_active??activity.global_rate??0},()=>({workspace_id:31,user_id:7,status:activity.user_active?'RESERVED':'SETTLED',active:activity.user_active?1:0,recent:1}))];
    if(sql.includes('SELECT workspace_id'))return [[{workspace_id:31,user_id:7,budget_day:'2026-10-08'}]];
    if(sql.includes('SELECT status'))return [[{status,reserved_tokens:100}]];
    return [{}];
  }};
  return {calls,repository:createModelConsumptionRepository({transaction:action=>action(db),config:modelBudgetConfig({MODEL_USER_DAILY_TOKENS:'100'})})};
}
test('workspace and user scope comes from authentication, and exhausted buckets reject before ledger claim',async()=>{
  const f=fixture({booked:99});await assert.rejects(f.repository.reserve('a'.repeat(43),{model:'Flash',purpose:'discussion',reservedTokens:2}),{code:'MODEL_BUDGET_EXHAUSTED'});
  assert.ok(!f.calls.some(c=>c.sql.includes('INSERT INTO model_consumption')));
  assert.ok(f.calls.some(c=>c.args?.includes('user:7')));
});
test('actual settlement refunds the reservation difference, uncertainty refunds nothing and replay is idempotent',async()=>{
  for(const usage of [null,{prompt_tokens:10,completion_tokens:5}]) {
    const f=fixture();const result=await f.repository.settle('id',usage);
    assert.equal(result.chargedTokens,usage?15:100);
    const updates=f.calls.filter(c=>c.sql.startsWith('UPDATE model_budget_buckets'));
    assert.equal(updates.length,3);assert.ok(updates.every(c=>c.args[0]===(usage?-85:0)));
  }
  const f=fixture({status:'SETTLED'});assert.deepEqual(await f.repository.settle('id',null),{replayed:true});
  assert.ok(!f.calls.some(c=>c.sql.startsWith('UPDATE')));
});
test('concurrency and rate limits apply before a new model request can reserve spending',async()=>{
  for(const activity of [{user_active:2},{global_rate:120}]) {
    const f=fixture({activity});await assert.rejects(f.repository.reserve('a'.repeat(43),{model:'Flash',purpose:'discussion',reservedTokens:1}),{status:429});
    assert.ok(!f.calls.some(c=>c.sql.includes('INSERT INTO model_consumption')));
  }
});
