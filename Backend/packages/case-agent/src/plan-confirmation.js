import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { PlanProposalSchema } from './plan-proposal.js';

const ConfirmationState = new StateSchema({
  decision: z.enum(['CONFIRM', 'REVISE']),
  section: z.enum(['DATA','EXPECTATIONS']).default('EXPECTATIONS'),
  versionNumber: z.number().int().positive(),
  phase: z.enum(['PROPOSAL_PENDING', 'AWAITING_REVISION', 'AWAITING_EXPECTATIONS', 'SOP_LOCKED']).default('PROPOSAL_PENDING'),
});

// The server binds the authenticated session and Case to this graph. Only an
// explicit structured decision enters the confirmation node; model text never does.
export function createPlanConfirmationGraph({ repository, token, chatPublicId, casePublicId }) {
  if (!repository || typeof repository.confirmSopProposal !== 'function') {
    throw new TypeError('repository.confirmSopProposal is required');
  }
  const graph = new StateGraph(ConfirmationState);
  const confirmSection = section => async ({ versionNumber }) => {
    const result=await repository.confirmSopProposal(token,chatPublicId,casePublicId,versionNumber,section);
    return {phase:result?.phase ?? (section==='DATA'?'AWAITING_EXPECTATIONS':'SOP_LOCKED')};
  };
  graph.addNode('confirm_plan_data',confirmSection('DATA'));
  graph.addNode('confirm_plan_expectations',confirmSection('EXPECTATIONS'));
  graph.addNode('request_revision',async()=>({phase:'AWAITING_REVISION'}));
  graph.addConditionalEdges(START,({decision,section})=>decision==='REVISE'?'request_revision':section==='DATA'?'confirm_plan_data':'confirm_plan_expectations',
    ['confirm_plan_data','confirm_plan_expectations','request_revision']);
  for(const node of ['confirm_plan_data','confirm_plan_expectations','request_revision'])graph.addEdge(node,END);
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

export async function decidePlan(graph, { decision, versionNumber, section = 'EXPECTATIONS' }) {
  if (!['DATA','EXPECTATIONS'].includes(section) || !['CONFIRM', 'REVISE'].includes(decision) ||
      !Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new TypeError('decision and versionNumber are required');
  }
  const state = await graph.invoke({ decision, versionNumber, section });
  return { phase: state.phase, versionNumber };
}
