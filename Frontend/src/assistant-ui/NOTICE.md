These components adapt assistant-ui Thread, MarkdownText, ArtifactCard, CanvasSplit, ApprovalCard, ThreadList, MessageAttachments, QuoteReply, AgentStatus, ToolCall, Timeline, Reasoning and Sources elements.

Source revision: cf81a88583c952d1942df0644ac1782ed95090f3

- https://github.com/assistant-ui/assistant-ui/blob/cf81a88583c952d1942df0644ac1782ed95090f3/packages/ui/src/components/react/assistant-ui/elements/thread.aui.tsx
- https://github.com/assistant-ui/assistant-ui/blob/cf81a88583c952d1942df0644ac1782ed95090f3/packages/ui/src/components/react/assistant-ui/elements/markdown-text.tsx

Changes: JSX and plain CSS, existing theme tokens and Case slots, supported text-only actions, Chinese labels, local clipboard failure feedback.

Additional upstream elements: https://github.com/assistant-ui/assistant-ui/tree/cf81a88583c952d1942df0644ac1782ed95090f3/packages/ui/src/components/react/assistant-ui/elements

Adaptations: transpiled JSX, existing liquid theme CSS, Chinese business labels, accessible Artifact button, no illustrative word/version counters, no permanent approval, current workflow rather than implied tool success, separate quoted context, actual plan explanation/evidence only. No streaming reasoning or fabricated citations.

MIT License

Copyright (c) 2026 AgentbaseAI Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
