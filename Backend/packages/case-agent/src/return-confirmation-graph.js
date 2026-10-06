import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { planReturnConfirmation } from '../../platform-protocol/src/return-confirmation.js';

const State = new StateSchema({
  application: z.unknown(),
  returnType: z.enum(['02', '04']),
  record: z.unknown(),
  phase: z.enum(['VERIFYING', 'APPLIED']).default('VERIFYING'),
  plan: z.unknown().nullable().default(null),
  applied: z.unknown().nullable().default(null),
});

export function createReturnConfirmationGraph({ channel, applyAccountConfirmation, applyTransactionConfirmation }) {
  if (typeof applyAccountConfirmation !== 'function' || typeof applyTransactionConfirmation !== 'function') {
    throw new TypeError('Both return confirmation apply callbacks are required');
  }
  const graph = new StateGraph(State);
  const verify = state => ({ plan: planReturnConfirmation({ ...state, channel }) });
  graph.addNode('verify_account_return', verify);
  graph.addNode('verify_transaction_return', verify);
  graph.addNode('apply_account_confirmation', async state => ({ phase: 'APPLIED',
    applied: await applyAccountConfirmation(state.plan, state) }));
  graph.addNode('apply_transaction_confirmation', async state => ({ phase: 'APPLIED',
    applied: await applyTransactionConfirmation(state.plan, state) }));
  graph.addConditionalEdges(START, state => state.returnType === '02' ? 'verify_account_return' : 'verify_transaction_return',
    ['verify_account_return', 'verify_transaction_return']);
  graph.addEdge('verify_account_return', 'apply_account_confirmation');
  graph.addEdge('verify_transaction_return', 'apply_transaction_confirmation');
  graph.addEdge('apply_account_confirmation', END).addEdge('apply_transaction_confirmation', END);
  return graph.compile();
}
