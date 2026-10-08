import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import {DISCUSSION_VOICE,checkDiscussionReply} from './discussion-reply.js';

export const FIRST_DISCUSSION_PROMPT_VERSION = 'first-discussion-guided-v4';
export const FIRST_DISCUSSION_PROMPT = DISCUSSION_VOICE + '\n这是首轮。需求已说明重点时不要再问用户最想验证什么；优先把关键风险与下一步说清楚。';

const FirstDiscussionState = new StateSchema({
  userInput: z.string(),
  reply: z.string().nullable().default(null),
  phase: z.enum(['DISCUSSING', 'AWAITING_USER']).default('DISCUSSING'),
});

export const checkFirstDiscussionReply = checkDiscussionReply;

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
