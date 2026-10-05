import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { PlanProposalSchema } from './plan-proposal.js';

const ConfirmationState = new StateSchema({
  decision: z.enum(['CONFIRM', 'REVISE']),
  versionNumber: z.number().int().positive(),
  phase: z.enum(['PROPOSAL_PENDING', 'AWAITING_REVISION', 'SOP_LOCKED']).default('PROPOSAL_PENDING'),
});

// The server binds the authenticated session and Case to this graph. Only an
// explicit structured decision enters the confirmation node; model text never does.
export function createPlanConfirmationGraph({ repository, token, chatPublicId, casePublicId }) {
  if (!repository || typeof repository.confirmSopProposal !== 'function') {
    throw new TypeError('repository.confirmSopProposal is required');
  }
  const graph = new StateGraph(ConfirmationState);
  graph.addNode('confirm_plan', async ({ versionNumber }) => {
    await repository.confirmSopProposal(token, chatPublicId, casePublicId, versionNumber);
    return { phase: 'SOP_LOCKED' };
  });
  graph.addNode('request_revision', async () => ({ phase: 'AWAITING_REVISION' }));
  graph.addConditionalEdges(START,
    ({ decision }) => decision === 'CONFIRM' ? 'confirm_plan' : 'request_revision',
    ['confirm_plan', 'request_revision']);
  graph.addEdge('confirm_plan', END).addEdge('request_revision', END);
  return graph.compile();
}

export async function stagePlanProposal(repository, { token, chatPublicId, casePublicId, proposal }) {
  const checked = PlanProposalSchema.safeParse(proposal);
  if (!checked.success) {
    const error = new Error('Plan 提案结构无效');
    error.code = 'INVALID_PLAN';
    throw error;
  }
  return repository.saveSopProposal(token, chatPublicId, casePublicId, checked.data);
}

export async function decidePlan(graph, { decision, versionNumber }) {
  if (!['CONFIRM', 'REVISE'].includes(decision) ||
      !Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new TypeError('decision and versionNumber are required');
  }
  const state = await graph.invoke({ decision, versionNumber });
  return { phase: state.phase, versionNumber };
}
