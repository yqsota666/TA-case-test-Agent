import { createReturnParsingGraph } from '../../case-agent/src/return-parsing-graph.js';

export function createReturnParsingService({ repository }) {
  return Object.freeze({
    async read(token, scope) {
      const { steps } = await repository.read(token, scope);
      return { steps: await Promise.all(steps.map(async step => {
        const state = await createReturnParsingGraph({ channel: step.channel }).invoke({ expectedType: step.expectedType });
        return { ...step, phase: step.parses.length ? 'PARSED' : state.phase };
      })) };
    },
    parse: (token, input) => repository.parse(token, input, target =>
      createReturnParsingGraph({ channel: target.channel }).invoke({ expectedType: target.expectedType, files: input.files })),
  });
}
