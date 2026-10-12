export function planApproval(plan,workflow) {
  if(!plan)return null;
  if(plan.status==='DRAFT')return {message:'方案还需完善，请查看缺少的条件，或在对话中让 AI 继续修改。'};
  if(plan.status==='PENDING_CONFIRMATION') {
    const dataConfirmed=plan.confirmations?.some(c=>c.section==='DATA');
    return dataConfirmed?{section:'EXPECTATIONS',label:'确认预期结果',message:'准备数据已确认。请核对预期结果；仍可通过对话或手动修改方案。'}:
      {section:'DATA',label:'确认准备数据',message:'请核对准备数据、业务条件及操作安排。确认后再核对预期结果。'};
  }
  if(plan.status==='LOCKED'&&(workflow?.stage==='PREPARE_DATA'||workflow?.stage==='CONFIRM_DRAFT'&&plan.dataApprovalMode==='PLAN_CONFIRMED'))return {section:'RETRY_DATA',label:'重试准备数据',message:'方案已确认，数据尚未准备完成。可以重试继续。'};
  return {message:'方案已确认。执行使用本次确认的内容，后续业务修改需另建测试。'};
}
