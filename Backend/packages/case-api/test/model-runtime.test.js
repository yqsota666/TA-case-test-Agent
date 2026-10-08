import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelRuntime,estimateModelInput} from '../src/model-runtime.js';
import {createSophnetCompletion} from '../../case-agent/src/sophnet.js';

function setup({usage={prompt_tokens:10,completion_tokens:4,total_tokens:14},error,maxCalls=8}={}) {
  const reserves=[],settlements=[],requests=[];
  const repository={reserve:async(token,input)=>{reserves.push({token,...input});return {id:'r'+reserves.length};},settle:async(...args)=>{settlements.push(args);}};
  const client={chat:{completions:{create:async request=>{requests.push(request);if(error)throw error;return {usage,choices:[{message:{content:'ok'}}]};}}}};
  const runtime=createModelRuntime({repository,maxCalls,maxOutput:100,completionFactory:options=>createSophnetCompletion({...options,client})});
  return {runtime,complete:runtime.completion({model:'Flash'}),reserves,settlements,requests};
}

test('authentication context is required before any provider request',async()=>{
  const f=setup();await assert.rejects(f.complete({system:'s',user:'u'}),{code:'MODEL_SCOPE_REQUIRED'});
  assert.equal(f.requests.length,0);assert.equal(f.reserves.length,0);
});
test('all calls reserve input and bounded output then settle actual provider usage',async()=>{
  const f=setup();
  await f.runtime.run({token:'trusted-session',purpose:'discussion'},async()=>{
    assert.equal(await f.complete({system:'s',user:'中文',maxTokens:20}),'ok');
    assert.equal(await f.complete({system:'s',user:'retry',maxTokens:200}),'ok');
  });
  assert.equal(f.reserves.length,2);assert.equal(f.reserves[0].token,'trusted-session');
  assert.equal(f.reserves[0].reservedTokens,59);assert.equal(f.requests[1].max_tokens,100);
  assert.equal(f.settlements.length,2);assert.equal(f.settlements[0][1].total_tokens,14);
});
test('timeouts and unknown usage keep a conservative charge; no free retry',async()=>{
  const f=setup({error:Object.assign(new Error('timeout'),{name:'APIConnectionTimeoutError'})});
  await f.runtime.run({token:'t',purpose:'plan'},async()=>{
    await assert.rejects(f.complete({system:'s',user:'u'}),{code:'MODEL_TIMEOUT'});
    await assert.rejects(f.complete({system:'s',user:'u'}),{code:'MODEL_TIMEOUT'});
  });
  assert.equal(f.reserves.length,2);assert.deepEqual(f.settlements.map(s=>s[1]),[null,null]);
});
test('budget refusal happens before provider invocation and preserves the actionable error',async()=>{
  let provider=0;
  const runtime=createModelRuntime({repository:{reserve:async()=>{throw Object.assign(new Error('budget'),{code:'MODEL_BUDGET_EXHAUSTED',status:429});}},
    completionFactory:options=>createSophnetCompletion({...options,client:{chat:{completions:{create:async()=>{provider++;}}}}})});
  await assert.rejects(runtime.run({token:'t'},()=>runtime.completion()({system:'s',user:'u'})),{code:'MODEL_BUDGET_EXHAUSTED'});
  assert.equal(provider,0);
});
test('request call cap includes retries and asynchronous request scopes do not mix users',async()=>{
  const f=setup({maxCalls:1});
  await Promise.all(['a','b'].map(token=>f.runtime.run({token,purpose:'plan'},async()=>{
    await f.complete({system:'s',user:'u'});
    await assert.rejects(f.complete({system:'s',user:'u'}),{code:'MODEL_RUN_LIMIT'});
  })));
  assert.deepEqual(f.reserves.map(r=>r.token).sort(),['a','b']);assert.equal(f.requests.length,2);
});
test('vision inputs have a nonzero reservation and oversized contexts fail before spending',async()=>{
  assert.equal(estimateModelInput([{content:[{type:'image_url',image_url:{url:'data:image/png;base64,a'}}]}]),131088);
  const f=setup();await assert.rejects(f.runtime.run({token:'t'},()=>f.complete({system:'s',user:'x'.repeat(600001)})),{code:'MODEL_INPUT_TOO_LARGE'});
  assert.equal(f.reserves.length,0);
});
