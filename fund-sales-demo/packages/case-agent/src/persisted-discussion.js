import { createDiscussionGraph, discussTurn } from './discussion-graph.js';

export function createPersistedDiscussionService({ repository, complete }) {
  if (!repository || typeof repository.readCaseDiscussion !== 'function' ||
      typeof repository.beginCaseDiscussionTurn !== 'function' ||
      typeof repository.finishCaseDiscussionTurn !== 'function' ||
      typeof repository.abandonCaseDiscussionTurn !== 'function') {
    throw new TypeError('repository discussion methods are required');
  }
  const graph = createDiscussionGraph({ complete });

  async function discuss({ token, chatPublicId, casePublicId, userInput }) {
    if (typeof userInput !== 'string' || !userInput.trim() || userInput.length > 4000) {
      throw new TypeError('userInput must contain 1–4000 characters');
    }
    const input = userInput.trim();
    const history = await repository.readCaseDiscussion(token, chatPublicId, casePublicId);
    if (history.pending && history.pending.userInput !== input) {
      const error = new Error('上一轮讨论尚未完成，请重试原输入或取消该轮');
      error.code = 'DISCUSSION_IN_PROGRESS';
      throw error;
    }
    const pending = history.pending ?? await repository.beginCaseDiscussionTurn(
      token, chatPublicId, casePublicId, { expectedRevision: history.revision, userInput: input });
    const result = await discussTurn(graph, { priorTurns: history.turns, userInput: input });
    const saved = await repository.finishCaseDiscussionTurn(token, chatPublicId, casePublicId, {
      turnNumber: pending.turnNumber,
      assistantReply: result.reply,
      promptVersion: result.promptVersion,
    });
    return { reply: result.reply, phase: result.phase, promptVersion: result.promptVersion,
      revision: saved.revision };
  }

  async function abandon({ token, chatPublicId, casePublicId, turnNumber }) {
    return repository.abandonCaseDiscussionTurn(token, chatPublicId, casePublicId, turnNumber);
  }

  return Object.freeze({ discuss, abandon });
}
