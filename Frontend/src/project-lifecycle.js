export function lifecycleView(snapshot, caseId) {
  const chat=snapshot?.chat, cases=snapshot?.cases??[];
  const active=chat?.status==='ACTIVE';
  const current=cases.find(item=>item.publicId===caseId);
  const successor=cases.find(item=>item.predecessorCasePublicId===caseId);
  return {active, sealed:['CLOSED','FORCE_CLOSED'].includes(chat?.status), canClose:active&&snapshot.canClose===true,
    canRetest:active&&current?.status==='FAIL'&&current.finalVerdict==='FAIL'&&!successor,
    successor, current, statusLabel:chat?.status==='CLOSED'?'已封存':chat?.status==='FORCE_CLOSED'?'已提前封存':active?'进行中':''};
}
export function lifecycleCommand(kind,{caseId,reason,preserve},requestId) {
  if(kind==='normal')return {route:'close',body:{mode:'NORMAL'}};
  if(!reason?.trim()||reason.trim().length>2000)throw new Error('请填写1–2000字说明。');
  if(kind==='force')return {route:'close',body:{mode:'FORCE',reason:reason.trim()}};
  if(kind==='retest')return {route:'retest',body:{requestId,casePublicId:caseId,reason:reason.trim()}};
  if(kind==='new-run'&&preserve===true)return {route:'new-run',body:{requestId,reason:reason.trim(),confirmPreserveFormalData:true}};
  throw new Error('请确认保留正式数据与历史记录。');
}
export const caseStatusLabel=item=>item.finalVerdict==='PASS'?'已通过':item.finalVerdict==='FAIL'?'未通过':'未完成';
