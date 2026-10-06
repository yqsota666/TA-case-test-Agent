import { createReturnConfirmationGraph } from '../../case-agent/src/return-confirmation-graph.js';

export function createReturnConfirmationService({ repository }) {
  return Object.freeze({
    read: (token, scope) => repository.read(token, scope),
    delivery: (token, input) => repository.delivery(token, input),
    salesData: token => repository.salesData(token),
    selectAccount: (token, input) => repository.selectAccount(token, input),
    applicationData: (token, scope, drafts) => repository.applicationData(token, scope, drafts),
    apply: (token, input) => repository.apply(token, input, async context => {
      const state = await createReturnConfirmationGraph({ channel: context.channel,
        applyAccountConfirmation: context.apply, applyTransactionConfirmation: context.apply }).invoke({
        returnType: context.expectedType, application: context.application, record: context.record });
      return state.applied;
    }),
  });
}
