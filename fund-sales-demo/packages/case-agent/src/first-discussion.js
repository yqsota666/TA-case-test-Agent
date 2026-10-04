import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';

export const FIRST_DISCUSSION_PROMPT_VERSION = 'first-node-format-v2';
export const FIRST_DISCUSSION_PROMPT = '你是基金销售 TA 测试讨论助手。现在只是与使用者讨论测试目标的第一轮回复。先询问使用者想验证什么，同时根据业务描述提出自己的初步理解和最值得确认的测试方向或歧义。不要生成完整 SOP、具体测试步骤或测试数据；不要把未确认的理解当作事实。输出简短中文纯文本，严格只写以下三行，每行小标题后直接写简短内容，不加空行，不使用 Markdown 标题、列表符号、加粗符号或代码块：\n想先确认：用一个问题询问使用者主要想验证什么。\n初步理解：概括你对业务规则和关键测试方向的初步判断。\n还需明确：点出最影响测试设计的几个未确定口径。';

const FirstDiscussionState = new StateSchema({
  userInput: z.string(),
  reply: z.string().nullable().default(null),
  phase: z.enum(['DISCUSSING', 'AWAITING_USER']).default('DISCUSSING'),
});

export function checkFirstDiscussionReply(reply) {
  const lines = typeof reply === 'string' ? reply.split('\n') : [];
  if (typeof reply !== 'string' || reply.length < 30 || reply.length > 300 ||
      reply !== reply.trim() || /\r|(?:\*\*|__|`|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s))/m.test(reply) ||
      lines.length !== 3 ||
      !/^想先确认：\S.+？$/.test(lines[0]) ||
      !/^初步理解：\S.+[。！？]$/.test(lines[1]) ||
      !/^还需明确：\S.+[。！？]$/.test(lines[2])) {
    const error = new Error('第一轮回复不符合三行中文纯文本格式');
    error.code = 'MODEL_OUTPUT_FORMAT';
    throw error;
  }
  return reply;
}

export function createFirstDiscussionGraph({ complete }) {
  if (typeof complete !== 'function') throw new TypeError('complete must be a function');
  const graph = new StateGraph(FirstDiscussionState);
  graph.addNode('ask_testing_intent', async ({ userInput }) => ({
    reply: checkFirstDiscussionReply(await complete({
      system: FIRST_DISCUSSION_PROMPT,
      user: userInput,
    })),
    phase: 'AWAITING_USER',
  }));
  graph.addEdge(START, 'ask_testing_intent').addEdge('ask_testing_intent', END);
  return graph.compile();
}

export async function discussFirstTurn(graph, userInput) {
  if (typeof userInput !== 'string' || !userInput.trim()) {
    throw new TypeError('userInput must be non-empty text');
  }
  const state = await graph.invoke({ userInput: userInput.trim() });
  return { reply: state.reply, phase: state.phase, promptVersion: FIRST_DISCUSSION_PROMPT_VERSION };
}
