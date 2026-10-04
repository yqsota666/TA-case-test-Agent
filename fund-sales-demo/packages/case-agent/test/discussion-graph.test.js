import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiscussionGraph, createSophnetCompletion, discussTurn } from '../src/index.js';

const requirement = '公募浮动管理费产品，持有期一年以内归管理人，满一年后根据收益率决定归属。';
const firstReply = '想先确认：你这次主要想验证哪一部分？\n初步理解：满一年会触发不同的费用归属判断。\n还需明确：持有期和收益率的计算口径。';
const followupReply = '当前理解：你想验证不同持有时间下的费用归属，具体边界仍可讨论。\n建议先测：分别设置未满一年、刚满一年和超过一年的持仓，比较相同收益率下的归属结果。\n请你确认：持有期起点应按申请日还是确认日计算？';

test('the second node uses the full conversation and can repeat after another user turn', async () => {
  const calls = [];
  const complete = async args => { calls.push(args); return calls.length === 1 ? firstReply : followupReply; };
  const graph = createDiscussionGraph({ complete });
  const first = await discussTurn(graph, { userInput: requirement });
  assert.equal(first.promptVersion, 'first-node-format-v2');
  assert.equal(first.phase, 'AWAITING_USER');
  const answer = '我想验证不同持有时间下的归属判断，边界由你来建议。';
  const second = await discussTurn(graph, { priorTurns: first.turns, userInput: answer });
  assert.equal(second.reply, followupReply);
  assert.equal(second.promptVersion, 'followup-discussion-v1');
  assert.deepEqual(calls[1].messages, [
    { role: 'user', content: requirement },
    { role: 'assistant', content: firstReply },
    { role: 'user', content: answer },
  ]);
  const third = await discussTurn(graph, { priorTurns: second.turns, userInput: '按确认日算，请继续。' });
  assert.equal(third.promptVersion, 'followup-discussion-v1');
  assert.equal(calls[2].messages.length, 5);
  assert.equal(third.turns.length, 6);
  assert.equal('plan' in third, false);
});

test('invalid transcript or malformed model output cannot advance the discussion', async () => {
  let called = false;
  const graph = createDiscussionGraph({ complete: async () => {
    called = true;
    return '## 测试计划\n- 直接执行';
  } });
  await assert.rejects(discussTurn(graph, { priorTurns: [{ role: 'assistant', content: firstReply }], userInput: '继续' }), TypeError);
  assert.equal(called, false);
  await assert.rejects(discussTurn(graph, {
    priorTurns: [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }],
    userInput: '继续',
  }), { code: 'MODEL_OUTPUT_FORMAT' });
});

test('Sophnet adapter sends previous user and assistant turns in order', async () => {
  const calls = [];
  const complete = createSophnetCompletion({ client: { chat: { completions: {
    create: async args => { calls.push(args); return { choices: [{ message: { content: followupReply } }] }; },
  } } } });
  const priorTurns = [{ role: 'user', content: requirement, name: 'ignored' }, { role: 'assistant', content: firstReply }];
  const result = await discussTurn(createDiscussionGraph({ complete }), { priorTurns, userInput: '边界请你提出。' });
  assert.equal(result.reply, followupReply);
  assert.deepEqual(calls[0].messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
  assert.equal('name' in calls[0].messages[1], false);
  assert.equal(calls[0].model, 'DeepSeek-V4-Pro-0813');
});

test('a short explanation after the confirmation question keeps the model wording intact', async () => {
  const reply = '当前理解：持有期按申购确认日至次年对日计算。\n建议先测：固定收益率，对比对日前一天、当天和后一天的归属结果。\n请你确认：终点按赎回申请日还是确认日？这会决定边界用例的日期。';
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  const result = await discussTurn(createDiscussionGraph({ complete: async () => reply }), {
    priorTurns, userInput: '按次年对日计算。',
  });
  assert.equal(result.reply, reply);
});
