export function planArtifactMeta(plan,workflow) {
  if(plan?.status==='DRAFT')return '还需完善条件';
  if(plan?.status==='PENDING_CONFIRMATION')return plan.confirmations?.some(c=>c.section==='DATA')?'待确认预期结果':'待确认准备数据';
  if(plan?.status==='LOCKED')return workflow?.stage==='PREPARE_DATA'?'数据待准备':'已确认';
  return '';
}
