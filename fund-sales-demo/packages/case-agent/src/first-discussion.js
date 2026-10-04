import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';

export const FIRST_DISCUSSION_PROMPT_VERSION = 'first-node-format-v4';
export const FIRST_DISCUSSION_PROMPT = '你是测试方案讨论助手。根据使用者刚提供的需求，询问其最想验证的目标，说明你的初步理解，并指出仍需澄清的信息。不要预设具体业务规则、测试方法或最终方案；本轮不要给出测试步骤、测试数据或 SOP 内容。输出简短中文纯文本，严格只写以下三行，每行小标题后直接写简短内容，不加空行，不使用 Markdown 标题、列表符号、加粗符号或代码块。第一行必须是以问号结尾的问题，中文或英文问号均可；后两行不限定句末标点：\n想先确认：询问使用者最想验证什么？\n初步理解：说明你目前的理解，未确认的内容不要写成事实。\n还需明确：指出继续讨论所需的关键信息。';

const FirstDiscussionState = new StateSchema({
  userInput: z.string(),
  reply: z.string().nullable().default(null),
  phase: z.enum(['DISCUSSING', 'AWAITING_USER']).default('DISCUSSING'),
});

export function checkFirstDiscussionReply(reply) {
  const lines = typeof reply === 'string' ? reply.split('\n') : [];
  if (typeof reply !== 'string' || reply.length < 30 || reply.length > 300 ||
      reply !== reply.trim() || /\r|(?:\*\*|__|`|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s))|(?:测试步骤|测试数据|执行步骤|SOP)[：:]/mi.test(reply) ||
      lines.length !== 3 ||
      !/^想先确认：\S.+[？?]$/.test(lines[0]) ||
      !/^初步理解：\S.+$/.test(lines[1]) ||
      !/^还需明确：\S.+$/.test(lines[2])) {
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
