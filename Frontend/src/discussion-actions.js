export function discussionAction({text, waiting=[], messages=[]}) {
  if (!waiting.includes('PROPOSE_PLAN') || messages.filter(m=>m.role==='assistant').length<2) return 'DISCUSS';
  const input=text.trim().replace(/[。！!]+$/,'');
  if (/^(?:请)?(?:帮我)?(?:整理|生成)(?:一下)?(?:测试)?(?:方案|plan)$/i.test(input)) return 'PROPOSE_PLAN';
  const previous=messages.at(-1);
  if (input==='继续' && previous?.role==='assistant' && /下一步[^\n]*回复[“「"']?继续[”」"']?[^\n]*方案/.test(previous.text)) return 'PROPOSE_PLAN';
  return 'DISCUSS';
}
