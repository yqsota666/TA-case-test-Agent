import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_DISCUSSION_PROMPT, createFirstDiscussionGraph, createSophnetCompletion, discussFirstTurn } from '../src/index.js';

const input = '公募浮动管理费产品，持有期一年以内归管理人，大于等于一年按收益率比较决定归属。';
const reply = '想先确认：你这次最想验证持有期分档，还是收益率比较？\n初步理解：满一年是重要边界，会触发不同的费用归属判断。\n还需明确：持有期起止日、收益率口径和比较基准。';

test('first graph node asks and waits without creating a plan', async () => {
  const calls = [];
  const graph = createFirstDiscussionGraph({ complete: async args => {
    calls.push(args);
    return reply;
  } });
  const result = await discussFirstTurn(graph, input);
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /不重复询问/);
  assert.equal(calls[0].user, input);
  assert.deepEqual(result, { reply, phase: 'AWAITING_USER', promptVersion: 'first-discussion-guided-v4' });
  assert.equal('plan' in result, false);
});

test('generic three-line reply accepts an English question mark and no terminal punctuation on other lines', async () => {
  const answer = '想先确认：你最想验证什么?\n初步理解：需要先明确判断目标\n还需明确：请说明预期的观察结果';
  const result = await discussFirstTurn(createFirstDiscussionGraph({ complete: async () => answer }), input);
  assert.equal(result.reply, answer);
});

test('first reply removes trailing spaces and tabs from each model line', async () => {
  const raw = reply.split('\n').join('  \n') + '\t  ';
  const result = await discussFirstTurn(createFirstDiscussionGraph({ complete: async () => raw }), input);
  assert.equal(result.reply, reply);
});

test('natural paragraphs and limited emphasis work without mandatory headings or questions', async () => {
  const answer='这次变化集中在**刚好满一年**的边界。建议把边界前后作为对照。\n\n你已经说明日期口径，接下来可以整理待确认方案。';
  const result=await discussFirstTurn(createFirstDiscussionGraph({complete:async()=>answer}),input);
  assert.equal(result.reply,answer);
});

test('unsafe markup and ungrounded completion claims are rejected', async()=>{
  for(const answer of ['<script>执行危险操作</script>这是一段不合规的回复。','我已生成最终方案并执行所有测试，请查看结果。','## 测试方案\n直接执行完整步骤。']) {
    await assert.rejects(discussFirstTurn(createFirstDiscussionGraph({complete:async()=>answer}),input),{code:'MODEL_OUTPUT_FORMAT'});
  }
});

test('plain identifier underscores remain valid in the first reply', async () => {
  const answer = '想先确认：你要验证哪个字段？\n初步理解：confirm_record_id 是需要核对的标识。\n还需明确：请说明它的生成口径。';
  const result = await discussFirstTurn(createFirstDiscussionGraph({ complete: async () => answer }), input);
  assert.equal(result.reply, answer);
});

test('Sophnet adapter uses the selected model and keeps model text unchanged', async () => {
  const calls = [];
  const complete = createSophnetCompletion({ client: { chat: { completions: {
    create: async args => { calls.push(args); return { choices: [{ message: { content: reply } }] }; },
  } } } });
  const result = await discussFirstTurn(createFirstDiscussionGraph({ complete }), input);
  assert.equal(result.reply, reply);
  assert.equal(calls[0].model, 'DeepSeek-V4-Pro-0813');
  assert.deepEqual(calls[0].messages.map(message => message.role), ['system', 'user']);
  assert.deepEqual(calls[0].messages.map(message => message.content), [FIRST_DISCUSSION_PROMPT, input]);
});


test('explicit low effort is forwarded for structured Plan generation without changing the model',async()=>{
 const calls=[];
 const complete=createSophnetCompletion({client:{chat:{completions:{create:async value=>{calls.push(value);return {choices:[{message:{content:'{}'}}]};}}}}});
 await complete({system:'结构化输出',user:'合成数据',reasoningEffort:'low'});
 assert.equal(calls[0].reasoning_effort,'low');assert.equal(calls[0].model,'DeepSeek-V4-Pro-0813');
 await assert.rejects(complete({system:'test',user:'test',reasoningEffort:'invalid'}),TypeError);
 assert.equal(calls.length,1);
 await complete({system:'结构化预期',user:'合成数据',thinkingMode:'disabled'});
 assert.deepEqual(calls[1].thinking,{type:'disabled'});
 assert.equal(calls[1].reasoning_effort,undefined);
 await assert.rejects(complete({system:'test',user:'test',thinkingMode:'invalid'}),TypeError);
});


test('Sophnet transport failures expose safe retryable codes without provider details',async()=>{
 for(const [error,code,status] of [
  [Object.assign(new Error('sensitive provider detail'),{name:'APIConnectionTimeoutError'}),'MODEL_TIMEOUT',504],
  [Object.assign(new Error('sensitive provider detail'),{name:'APIConnectionError'}),'MODEL_UNAVAILABLE',503],
  [Object.assign(new Error('sensitive provider detail'),{status:429}),'MODEL_UNAVAILABLE',503],
  [Object.assign(new Error('sensitive provider detail'),{status:503}),'MODEL_UNAVAILABLE',503],
  [Object.assign(new Error('sensitive provider detail'),{status:401}),'MODEL_PROVIDER_REJECTED',502]
 ]){
  const complete=createSophnetCompletion({client:{chat:{completions:{create:async()=>{throw error;}}}}});
  await assert.rejects(complete({system:'test',user:'test'}),e=>e.code===code&&e.status===status&&!e.message.includes('sensitive'));
 }
});
