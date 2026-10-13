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
  assert.equal(result.promptVersion, 'plan-proposal-draft-v13');
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

test('proposal accepts first-message requests while rejecting unsafe structure', async () => {
  let called = false;
  const graph = createDiscussionGraph({ complete: async () => { called = true; return JSON.stringify(proposal); } });
  const first=await proposeDiscussionPlan(graph, { priorTurns: [], userInput: '生成 Plan，03日期20261006，04日期20261007' });
  assert.equal(first.proposal.exchangePlan.status,'READY');
  assert.equal(called, true);
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
test('planning retries malformed model formatting once and never relaxes the proposal schema',async()=>{
  let calls=0;
  const graph=createDiscussionGraph({complete:async()=>++calls===1?'```json\n'+JSON.stringify(proposal)+'\n```':JSON.stringify(proposal)});
  const result=await proposeDiscussionPlan(graph,{priorTurns,userInput:'请整理Plan'});
  assert.deepEqual(result.proposal,proposal);assert.equal(calls,2);
  calls=0;await assert.rejects(proposeDiscussionPlan(createDiscussionGraph({complete:async()=>{calls++;return '{}';}}),{priorTurns,userInput:'请整理Plan'}),{code:'MODEL_OUTPUT_FORMAT'});
  assert.equal(calls,2);
});

test('only independent unconfirmed Chinese TA outcome clauses receive explicit status tokens',()=>{
 const raw={...proposal,openQuestions:[],scenarios:[{...proposal.scenarios[0],expected:'开户成功；申购失败；总份额100份'}]};
 const parsed=parsePlanProposal(JSON.stringify(raw));
 assert.equal(parsed.scenarios[0].expected,'开户申请状态为CONFIRMED（成功确认）；申购申请状态为FAILED（业务失败）；总份额100份');
 assert.deepEqual(parsed.openQuestions,[]);
 for(const expected of ['开户不成功','申购成功吗？','开户失败后申购成功','开户状态为CONFIRMED吗？','开户状态为CONFIRMED或FAILED','Case测试通过']){
  const result=parsePlanProposal(JSON.stringify({...raw,scenarios:[{...raw.scenarios[0],expected}]}));
  assert.equal(result.scenarios[0].expected,expected);
  assert.equal(result.openQuestions.length,expected==='Case测试通过'?0:1);
 }
 const existing={...proposal,openQuestions:[],scenarios:[{...proposal.scenarios[0],expected:'开户成功；状态CONFIRMED'}]};
 existing.contract=planContract(existing);
 assert.deepEqual(parsePlanProposal(JSON.stringify(existing)),existing,'existing contracts are never normalized');
});


test('TA receive-result language normalizes business expectation without asking for enum tokens',()=>{
 const p={...proposal,openQuestions:[],scenarios:[{...proposal.scenarios[0],expected:'02解析结果为开户成功；04解析结果为申购成功'}]};
 const result=parsePlanProposal(JSON.stringify(p));
 assert.deepEqual(result.openQuestions,[]);
 assert.match(result.scenarios[0].expected,/02解析结果为开户申请状态为CONFIRMED/);
 assert.match(result.scenarios[0].expected,/04解析结果为申购申请状态为CONFIRMED/);
 for(const expected of ['02解析结果为开户不成功','04解析结果为申购成功吗？','02解析结果为开户成功或失败']){
  const result=parsePlanProposal(JSON.stringify({...p,scenarios:[{...p.scenarios[0],expected}]}));
  assert.equal(result.scenarios[0].expected,expected);
 }
});

test('a comma-separated explicit status completes the same operation without creating a false business question',()=>{
 const raw={...proposal,openQuestions:[]};
 const expected='03申购申请以2000.00元确认成功，状态为CONFIRMED（成功确认），确认份额为2000.00份';
 const result=parsePlanProposal(JSON.stringify({...raw,scenarios:[{...raw.scenarios[0],expected}]}));
 assert.equal(result.scenarios[0].expected,expected);assert.deepEqual(result.openQuestions,[]);
 const repeated=parsePlanProposal(JSON.stringify({...raw,openQuestions:['请澄清场景1的TA业务确认结果：03申购申请以2000.00元确认成功','请澄清场景1的TA业务确认结果：02开户确认回传状态为CONFIRMED（成功确认）','实际手续费规则待明确'],scenarios:[{...raw.scenarios[0],expected}]}));
 assert.deepEqual(repeated.openQuestions,['实际手续费规则待明确']);
 for(const ambiguous of ['03申购申请以2000.00元确认成功，开户状态为CONFIRMED','03申购申请以2000.00元确认成功，状态为FAILED','申购是否确认成功，状态为CONFIRMED','03申购申请以2000.00元确认成功；状态为CONFIRMED']){
  const parsed=parsePlanProposal(JSON.stringify({...raw,scenarios:[{...raw.scenarios[0],expected:ambiguous}]}));
  assert.ok(parsed.openQuestions.length>0,ambiguous);
 }
});
