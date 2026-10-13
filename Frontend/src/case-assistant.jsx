import React, {useLayoutEffect} from 'react';
import {AssistantRuntimeProvider, useExternalStoreRuntime} from '@assistant-ui/react';

export function caseMessageToAssistant(message) {
  return {
    id: message.id,
    role: message.role,
    content: [{type: 'text', text: [message.text, message.continuation].filter(Boolean).join('\n\n')}],
    metadata: {custom: {caseMessage: message}},
  };
}

export function CaseAssistant({messages, draft, disabled, running, loading, onSend, children}) {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: caseMessageToAssistant,
    isRunning: running,
    isLoading: loading,
    isDisabled: disabled,
    unstable_persistsHistory: true,
    onNew: async message => {
      const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
      if (text && !disabled) await onSend(text);
    },
  });
  // Keep the runtime composer in sync with cleared or restored application drafts.
  useLayoutEffect(() => {
    if (runtime.thread.composer.getState().text !== draft) runtime.thread.composer.setText(draft);
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
