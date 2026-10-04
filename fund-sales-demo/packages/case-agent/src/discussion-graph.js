import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
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
} from './plan-proposal.js';

export const FOLLOWUP_DISCUSSION_PROMPT_VERSION = 'followup-discussion-v3';
export const FOLLOWUP_DISCUSSION_PROMPT = '你是测试方案讨论助手。阅读完整对话，以使用者最新补充或纠正为准。根据已确认的信息提出一项可讨论的测试方法，说明要观察什么；未确认的信息只作为待确认问题，不写成事实。此轮仍在讨论，不宣布最终 Plan，也不声称自己或系统已生成、锁定或执行任何方案；不执行操作。输出简短中文纯文本，严格只写以下三行，每行小标题后直接写简短内容，不加空行，不使用 Markdown 标题、列表符号、加粗符号或代码块。第三行必须包含一个以中文或英文问号结尾的问题，可以紧接一句简短解释：\n当前理解：概括目前已确认的目标和条件。\n建议先测：说明你建议的方法和观察结果。\n请你确认：询问下一步最需要使用者决定的事项？';

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

export function checkFollowupDiscussionReply(reply) {
  const lines = typeof reply === 'string' ? reply.split('\n') : [];
  if (typeof reply !== 'string' || reply.length < 30 || reply.length > 360 ||
      reply !== reply.trim() || /\r|(?:\*\*|__|`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\n]+\)|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s))/m.test(reply) ||
      /(?:我|我们|本助手|本系统|系统|AI)\s*(?:已|已经|现已)[^。！？\n]{0,20}(?:生成|制定|锁定|执行|提交|启动|完成|定稿|锁好|生成好|执行完)/i.test(reply) ||
      /(?:Plan|SOP|方案|测试)[^。！？\n]{0,6}(?:已|已经|现已)(?:生成|锁定|执行|完成|定稿)/i.test(reply) ||
      lines.length !== 3 ||
      !/^当前理解：\S.+/.test(lines[0]) ||
      !/^建议先测：\S.+/.test(lines[1]) ||
      !/^请你确认：\S.+[？?]/.test(lines[2])) {
    const error = new Error('后续讨论回复不符合三行中文纯文本格式');
    error.code = 'MODEL_OUTPUT_FORMAT';
    throw error;
  }
  return reply;
}

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

export function createDiscussionGraph({ complete }) {
  if (typeof complete !== 'function') throw new TypeError('complete must be a function');
  const graph = new StateGraph(DiscussionState);
  graph.addNode('ask_testing_intent', async ({ userInput }) => ({
    reply: checkFirstDiscussionReply(await complete({ system: FIRST_DISCUSSION_PROMPT, user: userInput })),
    phase: 'AWAITING_USER',
    promptVersion: FIRST_DISCUSSION_PROMPT_VERSION,
  }));
  graph.addNode('refine_test_approach', async ({ userInput, priorTurns }) => ({
    reply: checkFollowupDiscussionReply(await complete({
      system: FOLLOWUP_DISCUSSION_PROMPT,
      messages: [...priorTurns, { role: 'user', content: userInput }],
    })),
    phase: 'AWAITING_USER',
    promptVersion: FOLLOWUP_DISCUSSION_PROMPT_VERSION,
  }));
  graph.addNode('propose_plan', async ({ userInput, priorTurns }) => {
    if (priorTurns.length < 4) throw new Error('Plan 提案前至少需要两轮完整讨论');
    const proposal = parsePlanProposal(await complete({
      system: PLAN_PROPOSAL_PROMPT,
      messages: [...priorTurns, { role: 'user', content: userInput }],
    }));
    return {
      proposal,
      reply: displayPlanProposal(proposal),
      phase: 'PROPOSAL_PENDING',
      promptVersion: PLAN_PROPOSAL_PROMPT_VERSION,
    };
  });
  graph.addConditionalEdges(START,
    ({ mode, priorTurns }) => mode === 'PROPOSE_PLAN' ? 'propose_plan' :
      priorTurns.length ? 'refine_test_approach' : 'ask_testing_intent',
    ['ask_testing_intent', 'refine_test_approach', 'propose_plan']);
  graph.addEdge('ask_testing_intent', END).addEdge('refine_test_approach', END).addEdge('propose_plan', END);
  return graph.compile();
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
  if (priorTurns.length < 4) throw new Error('Plan 提案前至少需要两轮完整讨论');
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
