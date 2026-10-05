// Full transcripts remain in MySQL. Only this model-facing projection is compacted.
export function pendingCalls(messages) {
  const completed=new Set(messages.filter(m=>m.role==='tool').flatMap(m=>m.content.map(c=>c.toolCallId)));
  return messages.filter(m=>m.role==='assistant' && Array.isArray(m.content))
    .flatMap(m=>m.content.filter(c=>c.type==='tool-call')).filter(c=>!completed.has(c.toolCallId));
}

export function compactContext(rows) {
  const events=[...new Set(rows.map(r=>String(r.event_id)))],recent=new Set(events.slice(-3));
  const olderUsers=rows.filter(r=>!recent.has(String(r.event_id)) && r.event_source==='USER' && r.message_json.role==='user');
  const intent=olderUsers.length?[olderUsers[0],...olderUsers.slice(-3)].filter((r,i,a)=>a.indexOf(r)===i):[];
  const selected=[...intent,...rows.filter(r=>recent.has(String(r.event_id)))].map(r=>structuredClone(r.message_json));
  const parts=selected.flatMap(m=>m.role==='tool'?m.content:[]);
  const latestState=parts.filter(c=>c.toolName==='get_case_state').at(-1);
  const latestRules=parts.filter(c=>c.toolName==='get_business_rules').at(-1);
  for(const message of selected) {
    if(message.role!=='tool')continue;
    for(const part of message.content) {
      if(part.toolName==='get_case_state' && part!==latestState && part.output.type==='json') {
        const s=part.output.value;
        part.output.value={historical:true,caseId:s.caseId,runId:s.runId,planVersion:s.planVersion,
          counts:s.counts,progress:s.progress?.map(p=>({id:p.id,status:p.status})),
          notice:'历史状态详情已归档；下一步执行前调用get_case_state读取最新事实。'};
      }
      if(part.toolName==='get_business_rules' && part!==latestRules)part.output={type:'json',value:{historical:true,
        notice:'规则详情保存在后端，需要其他业务的必填字段时再次调用get_business_rules。'}};
    }
  }
  if(JSON.stringify(selected).length>100000)throw Object.assign(new Error('Model context requires smaller case'),{code:'CONTEXT_LIMIT'});
  return selected;
}
