import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirstDiscussionGraph, createSophnetCompletion, discussFirstTurn } from '../src/index.js';

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
  assert.match(calls[0].system, /询问使用者最想验证什么/);
  assert.equal(calls[0].user, input);
  assert.deepEqual(result, { reply, phase: 'AWAITING_USER', promptVersion: 'first-node-format-v4' });
  assert.equal('plan' in result, false);
});

test('generic three-line reply accepts an English question mark and no terminal punctuation on other lines', async () => {
  const answer = '想先确认：你最想验证什么?\n初步理解：需要先明确判断目标\n还需明确：请说明预期的观察结果';
  const result = await discussFirstTurn(createFirstDiscussionGraph({ complete: async () => answer }), input);
  assert.equal(result.reply, answer);
});

test('markdown and missing headings are rejected before reaching the user', async () => {
  const graph = createFirstDiscussionGraph({ complete: async () => '## 测试方案\n**先测试边界**' });
  await assert.rejects(discussFirstTurn(graph, input), { code: 'MODEL_OUTPUT_FORMAT' });
  const noQuestion = createFirstDiscussionGraph({ complete: async () => '想先确认：我理解要测试一年边界。\n初步理解：满一年时的费用归属需要核对。\n还需明确：持有期和收益率的计算口径。' });
  await assert.rejects(discussFirstTurn(noQuestion, input), { code: 'MODEL_OUTPUT_FORMAT' });
});

test('first turn rejects an explicit step or SOP section inside the three-line format', async () => {
  const withSteps = '想先确认：你要验证什么？\n初步理解：测试步骤：先准备，再执行。\n还需明确：预期结果是什么。';
  await assert.rejects(discussFirstTurn(createFirstDiscussionGraph({ complete: async () => withSteps }), input),
    { code: 'MODEL_OUTPUT_FORMAT' });
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
});
