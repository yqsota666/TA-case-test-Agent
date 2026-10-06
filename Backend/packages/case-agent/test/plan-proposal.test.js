import { planContract } from './plan-contract-fixture.js';
import { exchangePlan } from './exchange-plan-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDiscussionGraph,
  discussTurn,
  parsePlanProposal,
  proposeDiscussionPlan,
} from '../src/index.js';

const priorTurns = [
  { role: 'user', content: '业务日期20261006，回传日期20261007。同一笔申请的确认记录重复上传，需要怎么测试？' },
  { role: 'assistant', content: '想先确认：你最关注什么？\n初步理解：需要检查重复上传的处理。\n还需明确：你希望观察哪个结果。' },
  { role: 'user', content: '我关注账户份额不会重复增加。' },
  { role: 'assistant', content: '当前理解：目标是防止重复入账。\n建议先测：重复导入同一确认记录并核对份额。\n请你确认：是否还需检查明细？' },
];
const proposal = {
  objective: '验证重复确认不会重复入账',
  preconditions: ['准备一笔已有申请及其确认记录'],
  scenarios: [{
    title: '重复上传确认',
    setup: '记录上传前的账户份额',
    action: '两次上传同一确认记录',
    expected: '份额只增加一次',
    evidence: '两次上传结果及账户份额变动记录',
  }],
  exchangePlan,
  openQuestions: ['是否还需检查交易明细？'],
};

test('a plan request yields a reviewable proposal without locking it', async () => {
  const calls = [];
  const graph = createDiscussionGraph({ complete: async args => {
    calls.push(args);
    return JSON.stringify(proposal);
  } });
  const result = await proposeDiscussionPlan(graph, { priorTurns, userInput: '请整理为 Plan 提案。' });
  assert.equal(result.phase, 'PROPOSAL_PENDING');
  assert.equal(result.promptVersion, 'plan-proposal-v4');
  assert.deepEqual(result.proposal, proposal);
  assert.match(result.reply, /^测试目标：验证重复确认不会重复入账/);
  assert.match(result.reply, /场景 1：重复上传确认/);
  assert.match(result.reply, /准备条件 1：准备一笔已有申请及其确认记录/);
  assert.match(result.reply, /待确认 1：是否还需检查交易明细？/);
  assert.deepEqual(calls[0].messages.at(-1), { role: 'user', content: '请整理为 Plan 提案。' });
  assert.equal('locked' in result, false);

  const correction = await discussTurn(createDiscussionGraph({ complete: async () =>
    '当前理解：还要检查交易明细。\n建议先测：重复上传后核对账户与明细。\n请你确认：明细的判定口径是什么？' }), {
    priorTurns: result.turns,
    userInput: '还要检查交易明细。',
  });
  assert.equal(correction.phase, 'AWAITING_USER');
  assert.equal('proposal' in correction, false);
});

test('proposal guard and structural format reject premature or unsafe output', async () => {
  let called = false;
  const graph = createDiscussionGraph({ complete: async () => { called = true; return JSON.stringify(proposal); } });
  await assert.rejects(proposeDiscussionPlan(graph, { priorTurns: priorTurns.slice(0, 2), userInput: '生成 Plan' }));
  assert.equal(called, false);
  assert.deepEqual(parsePlanProposal(JSON.stringify(proposal)), proposal);
  assert.throws(() => parsePlanProposal('```json\n' + JSON.stringify(proposal) + '\n```'), { code: 'MODEL_OUTPUT_FORMAT' });
  assert.throws(() => parsePlanProposal(JSON.stringify({ ...proposal, scenarios: [] })), { code: 'MODEL_OUTPUT_FORMAT' });
  assert.throws(() => parsePlanProposal(JSON.stringify({ ...proposal, objective: '## 标题' })), { code: 'MODEL_OUTPUT_FORMAT' });
});

test('proposal fields reject inline Markdown', () => {
  for (const objective of ['验证*重复确认*不会重复入账', '验证_重复确认_不会重复入账',
    '验证[重复确认](https://example.com)不会重复入账']) {
    assert.throws(() => parsePlanProposal(JSON.stringify({ ...proposal, objective })),
      { code: 'MODEL_OUTPUT_FORMAT' });
  }
});

test('proposal parser accepts plain identifier underscores', () => {
  const identifierProposal = { ...proposal, objective: 'confirm_record_id' };
  assert.deepEqual(parsePlanProposal(JSON.stringify(identifierProposal)), identifierProposal);
});

test('only independent unconfirmed Chinese TA outcome clauses receive explicit status tokens',()=>{
 const raw={...proposal,openQuestions:[],scenarios:[{...proposal.scenarios[0],expected:'开户成功；申购失败；总份额100份'}]};
 const parsed=parsePlanProposal(JSON.stringify(raw));
 assert.equal(parsed.scenarios[0].expected,'开户申请状态为CONFIRMED（成功确认）；申购申请状态为FAILED（业务失败）；总份额100份');
 assert.deepEqual(parsed.openQuestions,[]);
 for(const expected of ['开户不成功','申购成功吗？','开户失败后申购成功','Case测试通过']){
  const result=parsePlanProposal(JSON.stringify({...raw,scenarios:[{...raw.scenarios[0],expected}]}));
  assert.equal(result.scenarios[0].expected,expected);
  assert.equal(result.openQuestions.length,expected==='Case测试通过'?0:1);
 }
 const existing={...proposal,openQuestions:[],scenarios:[{...proposal.scenarios[0],expected:'开户成功；状态CONFIRMED'}]};
 existing.contract=planContract(existing);
 assert.deepEqual(parsePlanProposal(JSON.stringify(existing)),existing,'existing contracts are never normalized');
});
