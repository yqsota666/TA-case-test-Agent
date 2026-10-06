import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { parseReturnFiles } from '../../platform-protocol/src/return-parsing.js';

const State = new StateSchema({
  expectedType: z.enum(['02', '04']),
  files: z.array(z.unknown()).nullable().default(null),
  phase: z.enum(['WAITING_UPLOAD', 'PARSED']).default('WAITING_UPLOAD'),
  parsed: z.unknown().nullable().default(null),
});

export function createReturnParsingGraph({ channel }) {
  const graph = new StateGraph(State);
  graph.addNode('wait_account_return', () => ({ phase: 'WAITING_UPLOAD' }));
  graph.addNode('wait_transaction_return', () => ({ phase: 'WAITING_UPLOAD' }));
  graph.addNode('parse_account_return', state => ({ phase: 'PARSED',
    parsed: parseReturnFiles(state.files, { expectedType: '02', channel }) }));
  graph.addNode('parse_transaction_return', state => ({ phase: 'PARSED',
    parsed: parseReturnFiles(state.files, { expectedType: '04', channel }) }));
  graph.addConditionalEdges(START, state => state.expectedType === '02' ?
    'wait_account_return' : 'wait_transaction_return', ['wait_account_return', 'wait_transaction_return']);
  graph.addConditionalEdges('wait_account_return', state => state.files === null ? END : 'parse_account_return',
    [END, 'parse_account_return']);
  graph.addConditionalEdges('wait_transaction_return', state => state.files === null ? END : 'parse_transaction_return',
    [END, 'parse_transaction_return']);
  graph.addEdge('parse_account_return', END).addEdge('parse_transaction_return', END);
  return graph.compile();
}
