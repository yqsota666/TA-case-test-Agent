import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import {
  FIRST_DISCUSSION_PROMPT,
  FIRST_DISCUSSION_PROMPT_VERSION,
  checkFirstDiscussionReply,
} from './first-discussion.js';

export const FOLLOWUP_DISCUSSION_PROMPT_VERSION = 'followup-discussion-v1';
export const FOLLOWUP_DISCUSSION_PROMPT = '你是基金销售 TA 测试讨论助手。阅读完整对话，特别是使用者最新回答；使用者的纠正优先于你先前的猜测。严格区分已确认事实、自己的推测和仍待确认的口径，不要用看似相近却不等价的算法替换已确认规则。根据已有信息提出一个具体但可修改的测试方法，主动寻找边界、对照或反例，不要求使用者先说出测试关键词。说清要改变什么条件、观察什么结果；日期或数字依赖未确认口径时，用边界前、边界当天、边界后等相对描述，不擅自指定固定天数。未知业务口径只能列为待确认，不能编造为事实。这仍是讨论，不能生成完整 SOP 或宣布最终 Plan，不能执行或锁定任何操作。输出简短中文纯文本，严格只写以下三行，每行小标题后直接写简短内容，不加空行，不使用 Markdown 标题、列表符号、加粗符号或代码块：\n当前理解：归纳已确认的测试目标，并区分你自己的推测。\n建议先测：给出一项可操作的测试方法和要观察的结果。\n请你确认：用一个问题询问最影响下一步的未确定点或方案取舍。';

const Turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });
const DiscussionState = new StateSchema({
  userInput: z.string(),
  priorTurns: z.array(Turn).default([]),
  reply: z.string().nullable().default(null),
  phase: z.enum(['DISCUSSING', 'AWAITING_USER']).default('DISCUSSING'),
  promptVersion: z.string().nullable().default(null),
});

export function checkFollowupDiscussionReply(reply) {
  const lines = typeof reply === 'string' ? reply.split('\n') : [];
  if (typeof reply !== 'string' || reply.length < 30 || reply.length > 360 ||
      reply !== reply.trim() || /\r|(?:\*\*|__|`|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s))/m.test(reply) ||
      lines.length !== 3 ||
      !/^当前理解：\S.+/.test(lines[0]) ||
      !/^建议先测：\S.+/.test(lines[1]) ||
      !/^请你确认：\S.+？/.test(lines[2])) {
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
  graph.addConditionalEdges(START,
    ({ priorTurns }) => priorTurns.length ? 'refine_test_approach' : 'ask_testing_intent',
    ['ask_testing_intent', 'refine_test_approach']);
  graph.addEdge('ask_testing_intent', END).addEdge('refine_test_approach', END);
  return graph.compile();
}

export async function discussTurn(graph, { priorTurns = [], userInput }) {
  validatePriorTurns(priorTurns);
  if (typeof userInput !== 'string' || !userInput.trim()) {
    throw new TypeError('userInput must be non-empty text');
  }
  const input = userInput.trim();
  const safeTurns = priorTurns.map(({ role, content }) => ({ role, content }));
  const state = await graph.invoke({ priorTurns: safeTurns, userInput: input });
  return {
    reply: state.reply,
    phase: state.phase,
    promptVersion: state.promptVersion,
    turns: [...safeTurns, { role: 'user', content: input }, { role: 'assistant', content: state.reply }],
  };
}
