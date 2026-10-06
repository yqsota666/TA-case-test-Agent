import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { parseReturnFiles } from '../../platform-protocol/src/return-parsing.js';
import { planHoldingsSync } from '../../platform-protocol/src/holdings-return.js';
const State = new StateSchema({
  files: z.array(z.unknown()).nullable().default(null),
  parsed: z.unknown().nullable().default(null),
  rows: z.array(z.unknown()).default([]),
  result: z.unknown().nullable().default(null),
  phase: z.enum(['WAITING_UPLOAD','PARSED','VERIFIED','SYNCED']).default('WAITING_UPLOAD'),
});
export function createHoldingsParsingGraph({ channel }) {
  const graph = new StateGraph(State);
  graph.addNode('wait_holdings_return', () => ({ phase: 'WAITING_UPLOAD' }));
  graph.addNode('parse_holdings_return', state => ({ phase: 'PARSED',
    parsed: parseReturnFiles(state.files, { expectedType: '05', channel }) }));
  graph.addEdge(START,'wait_holdings_return');
  graph.addConditionalEdges('wait_holdings_return', state => state.files === null ? END : 'parse_holdings_return', [END,'parse_holdings_return']);
  graph.addEdge('parse_holdings_return',END);
  return graph.compile();
}
export function createHoldingsSyncGraph({ channel, sync }) {
  const graph = new StateGraph(State);
  graph.addNode('verify_holdings_return', state => ({ phase:'VERIFIED', rows:planHoldingsSync(state.parsed,channel) }));
  graph.addNode('sync_holdings_snapshot', async state => ({ phase:'SYNCED', result:await sync(state.rows) }));
  graph.addEdge(START,'verify_holdings_return').addEdge('verify_holdings_return','sync_holdings_snapshot').addEdge('sync_holdings_snapshot',END);
  return graph.compile();
}
