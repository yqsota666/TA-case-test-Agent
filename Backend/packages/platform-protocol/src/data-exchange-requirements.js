// Data drafts describe requested synthetic resources, not TA-confirmed resources.
export function dataExchangeRequirementIssues(plan) {
  const d=plan?.contract?.dataSpecification;
  if(!d)return [];
  const steps=plan.exchangePlan?.steps??[];
  const applications=plan.contract.applications??[];
  const sends=type=>steps.filter(s=>s.direction==='SEND'&&s.fileType===type&&s.required===true);
  const required=[];
  const orphanCustomers=d.customers?.length && !d.accounts?.length && !applications.some(a=>a.transactionAccountId);
  if(d.accounts?.length || orphanCustomers)required.push('01');
  if((d.accounts?.length || orphanCustomers) && (d.funds?.length || d.holdings?.length))required.push('03');
  const issues=orphanCustomers?['新模拟客户需要准备交易账户引用，不能以空账户绕过文件构造']:[];
  for(const type of required) {
    const candidates=sends(type);
    if(!candidates.length) {issues.push(`准备模拟数据需要${type}申请及对应回传步骤，不能跳过文件交换`);continue;}
    const returned=type==='01'?'02':'04';
    if(candidates.some(s=>!steps.some(r=>r.direction==='RECEIVE'&&r.fileType===returned&&r.required===true&&r.roundId===s.roundId&&r.dependsOn.some(dep=>dep.stepId===s.stepId&&dep.condition==='SENT'))))issues.push(`${type}申请缺少必需的${returned}回传步骤`);
    const bound=new Set(applications.filter(a=>candidates.some(s=>s.stepId===a.stepId)).map(a=>a.accountIndex));
    if(d.accounts.some((_,i)=>!bound.has(i)))issues.push(`${type}申请尚未覆盖需要构造的模拟账户`);
  }
  if(required.includes('03') && sends('03').length) {
    const unbound=applications.filter(a=>sends('03').some(s=>s.stepId===a.stepId)&&Number.isInteger(a.accountIndex)).some(a=>{
      const openings=applications.filter(o=>o.accountIndex===a.accountIndex&&sends('01').some(s=>s.stepId===o.stepId));
      const returns=steps.filter(r=>r.fileType==='02'&&r.direction==='RECEIVE'&&r.required===true&&r.dependsOn.some(dep=>dep.condition==='SENT'&&openings.some(o=>o.stepId===dep.stepId)));
      const subscription=steps.find(s=>s.stepId===a.stepId);
      return !returns.some(r=>subscription.dependsOn.some(dep=>dep.stepId===r.stepId&&dep.condition==='CONFIRMED'));
    });
    if(unbound)issues.push('新模拟账户的03申请必须等待对应02成功确认');
    if(d.holdings?.some(h=>!applications.some(a=>sends('03').some(s=>s.stepId===a.stepId)&&a.accountIndex===h.accountIndex&&a.fundIndex===h.fundIndex)))issues.push('03申请尚未覆盖需要构造的基金持仓');
  }
  return issues;
}
