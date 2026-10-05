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
  assert.equal(first.promptVersion, 'first-node-format-v4');
  assert.equal(first.phase, 'AWAITING_USER');
  const answer = '我想验证不同持有时间下的归属判断，边界由你来建议。';
  const second = await discussTurn(graph, { priorTurns: first.turns, userInput: answer });
  assert.equal(second.reply, followupReply);
  assert.equal(second.promptVersion, 'followup-discussion-v3');
  assert.deepEqual(calls[1].messages, [
    { role: 'user', content: requirement },
    { role: 'assistant', content: firstReply },
    { role: 'user', content: answer },
  ]);
  const third = await discussTurn(graph, { priorTurns: second.turns, userInput: '按确认日算，请继续。' });
  assert.equal(third.promptVersion, 'followup-discussion-v3');
  assert.equal(calls[2].messages.length, 5);
  assert.equal(third.turns.length, 6);
  assert.equal('plan' in third, false);
});

test('discussion rejects a claim that a plan was already generated or executed', async () => {
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  for (const claim of ['我已生成最终 Plan 并执行。', '我已制定最终方案。', '我已把 SOP 锁好。',
    '本助手已将最终 Plan 定稿。']) {
    const reply = `当前理解：已确认目标。\n建议先测：检查结果。\n请你确认：现在继续吗？${claim}`;
    await assert.rejects(discussTurn(createDiscussionGraph({ complete: async () => reply }),
      { priorTurns, userInput: '继续讨论。' }), { code: 'MODEL_OUTPUT_FORMAT' });
  }
  await assert.rejects(discussTurn(createDiscussionGraph({ complete: async () =>
    '当前理解：本助手已将最终 Plan 定稿。\n建议先测：检查结果。\n请你确认：继续吗？' }),
  { priorTurns, userInput: '继续讨论。' }), { code: 'MODEL_OUTPUT_FORMAT' });
});

test('discussion keeps a user history of prior execution and accepts an English question mark', async () => {
  const reply = '当前理解：你已经执行过一轮回归测试，结果需复核。\n建议先测：核对相同输入下的回传与预期。\n请你确认：之前使用的是哪个业务日期?';
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  const result = await discussTurn(createDiscussionGraph({ complete: async () => reply }),
    { priorTurns, userInput: '请继续分析。' });
  assert.equal(result.reply, reply);
});

test('follow-up reply removes trailing spaces and tabs before storing the turn', async () => {
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  const raw = followupReply.split('\n').join('  \n') + '\t  ';
  const result = await discussTurn(createDiscussionGraph({ complete: async () => raw }),
    { priorTurns, userInput: '请继续分析。' });
  assert.equal(result.reply, followupReply);
  assert.equal(result.turns.at(-1).content, followupReply);
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

test('follow-up rejects inline Markdown in its plain-text reply', async () => {
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  for (const detail of ['*一年边界*', '_一年边界_', '[一年边界](https://example.com)']) {
    const reply = `当前理解：${detail}可能影响费用归属。\n建议先测：比较边界前后的结果。\n请你确认：具体口径是什么？`;
    await assert.rejects(discussTurn(createDiscussionGraph({ complete: async () => reply }),
      { priorTurns, userInput: '请继续。' }), { code: 'MODEL_OUTPUT_FORMAT' });
  }
});

test('plain identifier underscores remain valid in follow-up replies', async () => {
  const priorTurns = [{ role: 'user', content: requirement }, { role: 'assistant', content: firstReply }];
  const reply = '当前理解：confirm_record_id 是需要核对的标识。\n建议先测：对比重复上传前后的记录。\n请你确认：该字段由谁生成？';
  const result = await discussTurn(createDiscussionGraph({ complete: async () => reply }),
    { priorTurns, userInput: '请继续。' });
  assert.equal(result.reply, reply);
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
