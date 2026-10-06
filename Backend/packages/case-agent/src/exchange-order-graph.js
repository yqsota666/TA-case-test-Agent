import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { validateExchangeOrder } from '../../platform-protocol/src/exchange-plan.js';
export function createExchangeOrderGraph() {
  const graph = new StateGraph(new StateSchema({ input:z.unknown(), checked:z.unknown().nullable().default(null) }));
  graph.addNode('validate_exchange_order', ({input})=>({checked:validateExchangeOrder(input)}));
  graph.addEdge(START,'validate_exchange_order').addEdge('validate_exchange_order',END);
  return graph.compile();
}
