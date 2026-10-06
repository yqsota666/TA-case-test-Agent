import { createReturnParsingGraph } from '../../case-agent/src/return-parsing-graph.js';

export function createReturnParsingService({ repository }) {
  return Object.freeze({
    async read(token, scope) {
      const { steps, ...planning } = await repository.read(token, scope);
      return { ...planning, steps: await Promise.all(steps.map(async step => {
        const state = await createReturnParsingGraph({ channel: step.channel }).invoke({ expectedType: step.expectedType });
        return { ...step, phase: step.parses.some(p=>p.orderAccepted) ? 'PARSED' : step.parses.length ? 'ORDER_REJECTED' : state.phase };
      })) };
    },
    parse: (token, input) => repository.parse(token, input, target =>
      createReturnParsingGraph({ channel: target.channel }).invoke({ expectedType: target.expectedType, files: input.files })),
  });
}
