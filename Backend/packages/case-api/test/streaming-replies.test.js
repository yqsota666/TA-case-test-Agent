import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCaseHttpServer} from '../src/http.js';
import {createModelRuntime} from '../src/model-runtime.js';
import {createSophnetCompletion} from '../../case-agent/src/sophnet.js';

test('streamed completion emits only answer text and settles the final usage',async()=>{
  const deltas=[],settlements=[];
  const usage={prompt_tokens:10,completion_tokens:8,total_tokens:18};
  const client={chat:{completions:{create:async request=>{
    assert.equal(request.stream,true);assert.equal(request.stream_options.include_usage,true);
    return (async function*(){yield {choices:[{delta:{reasoning_content:'private'}}]};yield {choices:[{delta:{content:'中文'}}]};yield {choices:[{delta:{content:'回复'}}]};yield {choices:[],usage};})();
  }}}};
  const runtime=createModelRuntime({maxOutput:100,repository:{reserve:async()=>({id:'r'}),settle:async(...args)=>settlements.push(args)},completionFactory:options=>createSophnetCompletion({...options,client})});
  const reply=await runtime.run({token:'session',purpose:'discussion'},()=>runtime.completion()({system:'s',user:'u',onDelta:text=>deltas.push(text)}));
  assert.equal(reply,'中文回复');assert.deepEqual(deltas,['中文','回复']);assert.deepEqual(settlements,[['r',usage]]);
});

test('partial provider failure preserves quota uncertainty and rejects the completion',async()=>{
  const settled=[],deltas=[];
  const client={chat:{completions:{create:async()=> (async function*(){yield {choices:[{delta:{content:'部分'}}]};throw Object.assign(new Error('upstream'),{code:'ECONNRESET'});})()}}};
  const runtime=createModelRuntime({repository:{reserve:async()=>({id:'r'}),settle:async(...args)=>settled.push(args)},completionFactory:options=>createSophnetCompletion({...options,client})});
  await assert.rejects(runtime.run({token:'session'},()=>runtime.completion()({system:'s',user:'u',onDelta:text=>deltas.push(text)})),{code:'MODEL_UNAVAILABLE'});
  assert.deepEqual(deltas,['部分']);assert.deepEqual(settled,[['r',null]]);
});

const path='/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/discussion';
test('SSE delivers a delta before persistence completes, and terminal failures are SSE errors',async t=>{
  let finish;
  const gate=new Promise(resolve=>finish=resolve);
  let fail=false;
  const server=createCaseHttpServer({allowedOrigin:'http://localhost:3100',accountAuth:{current:async()=>({user:{id:'u'}})},repository:{},confirmPlan:async()=>{},executeData:async()=>{},reviseData:async()=>{},discussionService:{discuss:async({onDelta})=>{
    onDelta('增量');await gate;if(fail)throw Object.assign(new Error('服务不可用'),{status:503,code:'MODEL_UNAVAILABLE'});return {reply:'增量回复',revision:1};
  }}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const send=()=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Origin:'http://localhost:3100',Cookie:'case_session=s',Accept:'text/event-stream','Content-Type':'application/json'},body:JSON.stringify({userInput:'测试输入'})});
  const response=await send();assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: delta/);assert.doesNotMatch(first,/event: result/);
  finish();let tail='';while(true){const {value,done}=await reader.read();if(done)break;tail+=new TextDecoder().decode(value);}
  assert.match(tail,/event: result/);assert.match(tail,/"revision":1/);
  fail=true;const failure=await (await send()).text();assert.match(failure,/event: error/);assert.match(failure,/MODEL_UNAVAILABLE/);assert.doesNotMatch(failure,/event: result/);
});
