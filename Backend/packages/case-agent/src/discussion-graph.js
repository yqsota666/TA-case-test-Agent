import {observeGraph} from './observability.js';
import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import {DISCUSSION_VOICE,checkDiscussionReply,completeDiscussionReply} from './discussion-reply.js';
import {
  FIRST_DISCUSSION_PROMPT,
  FIRST_DISCUSSION_PROMPT_VERSION,
  checkFirstDiscussionReply,
} from './first-discussion.js';
import {
  PLAN_PROPOSAL_PROMPT,
  PLAN_PROPOSAL_PROMPT_VERSION,
  displayPlanProposal,
  parsePlanProposal,
  guardExchangeTimeEvidence,
} from './plan-proposal.js';

export const FOLLOWUP_DISCUSSION_PROMPT_VERSION = 'followup-discussion-draft-adaptive-v7';
export const FOLLOWUP_DISCUSSION_PROMPT = DISCUSSION_VOICE + '\n阅读完整对话，以用户最新纠正为准。承接上轮问题的答案，推动下一步，不循环索要已经提供的信息。';

const Turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });
const DiscussionState = new StateSchema({
  mode: z.enum(['DISCUSS', 'PROPOSE_PLAN']).default('DISCUSS'),
  userInput: z.string(),
  priorTurns: z.array(Turn).default([]),
  reply: z.string().nullable().default(null),
  phase: z.enum(['DISCUSSING', 'AWAITING_USER', 'PROPOSAL_PENDING']).default('DISCUSSING'),
  promptVersion: z.string().nullable().default(null),
  proposal: z.unknown().nullable().default(null),
});

export const checkFollowupDiscussionReply = checkDiscussionReply;

function validatePriorTurns(priorTurns) {
  if (!Array.isArray(priorTurns) || priorTurns.length % 2 !== 0) {
    throw new TypeError('priorTurns must contain complete user/assistant pairs');
  }
  for (const [index, turn] of priorTurns.entries()) {
    if (!turn || turn.role !== (index % 2 === 0 ? 'user' : 'assistant') ||
        typeof turn.content !== 'string' || !turn.content.trim()) {
      throw new TypeError('priorTurns must alternate non-empty user and assistant messages');
    }
  }
}

export function createDiscussionGraph({ complete, onDelta, onReset, signal, discussionContext={}, proposalRepair, currentProposal }) {
  if (typeof complete !== 'function') throw new TypeError('complete must be a function');
  const graph = new StateGraph(DiscussionState);
  graph.addNode('ask_testing_intent', async ({ userInput }) => ({
    reply: await completeDiscussionReply(complete,{ system: FIRST_DISCUSSION_PROMPT, user: userInput, ...(onDelta?{onDelta,onReset,signal}:{}) },discussionContext),
    phase: 'AWAITING_USER',
    promptVersion: FIRST_DISCUSSION_PROMPT_VERSION,
  }));
  graph.addNode('refine_test_approach', async ({ userInput, priorTurns }) => ({
    reply: await completeDiscussionReply(complete,{
      system: FOLLOWUP_DISCUSSION_PROMPT+(discussionContext.needsClarification?' 本轮无法明确用户省略表达所指的操作，请只澄清影响下一步的具体指代，不反复解释系统流程。':''),
      ...(onDelta?{onDelta,onReset,signal}:{}),
      messages: [...priorTurns, { role: 'user', content: userInput }],
    },discussionContext),
    phase: 'AWAITING_USER',
    promptVersion: FOLLOWUP_DISCUSSION_PROMPT_VERSION,
  }));
  graph.addNode('propose_plan', async ({ userInput, priorTurns }) => {
    const proposeComplete=request=>complete(currentProposal?{...request,
      system:request.system+' currentProposal是当前已保存的业务草稿，仅供承接条件；不证明已确认或已执行。用户最新输入优先。历史AI失败诊断、可选核验建议和技术缺失不是用户新增要求，不继承为业务问题；重新检查当前用户已给的日期、同包安排与实际业务规则。',
      messages:request.messages.map((turn,i)=>i===priorTurns.length?{...turn,content:JSON.stringify({userInput:turn.content,currentProposal})}:turn),
    }:request);
    let parsed,previous,proposal;
    for(let attempt=0;attempt<2;attempt++){
      const reply=await proposeComplete({thinkingMode:'disabled',reasoningEffort:'low',
        system:PLAN_PROPOSAL_PROMPT+(proposalRepair?' 上次文件安排与后续申请契约不一致。请依据proposalRepair修复文件安排，保持用户业务条件、日期与真实未来结果依赖；不能机械删除真实依赖。只生成修复后的方案JSON。':'')+(attempt?' 上次格式或日期证据校验未通过。只修正JSON结构、日期格式、模拟日期标识和纯文本字段，保留用户范围与业务值；用户允许模拟日期时，preconditions逐文件写为【模拟假设】01业务日期YYYYMMDD等；不可改写用户指定日期、取消或待定指令。必须直接以{开头、以}结尾，不能含代码围栏、解释或额外字段。':''),
        messages:[...priorTurns,{role:'user',content:proposalRepair?JSON.stringify({userInput,proposalRepair}):userInput},...(attempt?[{role:'assistant',content:previous},{role:'user',content:'请修正上述方案输出格式及日期证据：模拟日期必须明确标为【模拟假设】并逐文件列出日期。用户指定、改期或待定仍优先，不能为了READY捏造真实时间。业务条件仍以原对话为准。'}]:[])]});
      try{
        parsed=parsePlanProposal(reply);
        proposal=guardExchangeTimeEvidence(parsed,[...priorTurns.filter(turn=>turn.role==='user').map(turn=>turn.content),userInput]);
        const draftDates=parsed.preconditions.some(value=>/模拟.*(?:日期|日)|(?:日期|日).*模拟/.test(value)) || [...priorTurns.filter(turn=>turn.role==='user').map(turn=>turn.content),userInput].some(value=>/日期.{0,12}模拟|模拟.{0,12}日期/.test(value));
        if(attempt===0 && draftDates && parsed.exchangePlan.status==='READY' && proposal.exchangePlan.status==='UNPLANNED'){previous=reply;continue;}
        break;
      }catch(e){if(e.code!=='MODEL_OUTPUT_FORMAT'||attempt===1)throw e;previous=reply;}
    }
    return {
      proposal,
      reply: displayPlanProposal(proposal),
      phase: 'PROPOSAL_PENDING',
      promptVersion: PLAN_PROPOSAL_PROMPT_VERSION,
    };
  });
  graph.addEdge('propose_plan', END);
  graph.addConditionalEdges(START,
    ({ mode, priorTurns }) => mode === 'PROPOSE_PLAN' ? 'propose_plan' :
      priorTurns.length ? 'refine_test_approach' : 'ask_testing_intent',
    ['ask_testing_intent', 'refine_test_approach', 'propose_plan']);
  graph.addEdge('ask_testing_intent', END).addEdge('refine_test_approach', END);
  return observeGraph(graph.compile());
}

export async function discussTurn(graph, { priorTurns = [], userInput }) {
  validatePriorTurns(priorTurns);
  if (typeof userInput !== 'string' || !userInput.trim()) {
    throw new TypeError('userInput must be non-empty text');
  }
  const input = userInput.trim();
  const safeTurns = priorTurns.map(({ role, content }) => ({ role, content }));
  const state = await graph.invoke({ mode: 'DISCUSS', priorTurns: safeTurns, userInput: input, proposal: null });
  return {
    reply: state.reply,
    phase: state.phase,
    promptVersion: state.promptVersion,
    turns: [...safeTurns, { role: 'user', content: input }, { role: 'assistant', content: state.reply }],
  };
}

export async function proposeDiscussionPlan(graph, { priorTurns = [], userInput }) {
  validatePriorTurns(priorTurns);
  if (typeof userInput !== 'string' || !userInput.trim()) {
    throw new TypeError('userInput must be non-empty text');
  }
  const input = userInput.trim();
  const safeTurns = priorTurns.map(({ role, content }) => ({ role, content }));
  const state = await graph.invoke({ mode: 'PROPOSE_PLAN', priorTurns: safeTurns, userInput: input, proposal: null });
  return {
    proposal: state.proposal,
    reply: state.reply,
    phase: state.phase,
    promptVersion: state.promptVersion,
    turns: [...safeTurns, { role: 'user', content: input }, { role: 'assistant', content: state.reply }],
  };
}
