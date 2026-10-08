import {TRANSACTION_BUSINESSES} from './businesses.js';

const accountNames = { '001':'开户', '002':'销户', '003':'账户信息变更', '004':'账户冻结', '005':'账户解冻', '006':'账户登记', '007':'账户业务', '008':'账户业务', '009':'账户业务' };
export const operationName = (type, code) => type === '01' ? accountNames[code] ?? `账户业务 ${code}` : TRANSACTION_BUSINESSES[code]?.name ?? `交易业务 ${code}`;
export const canApplyOperation = (type, code) => type === '01' ? code === '001' : ['022','024'].includes(code);
export const supportedOperation = (type, code) => type === '01' ? /^00[1-9]$/.test(code) : !!TRANSACTION_BUSINESSES[code];

export function waitsForReceipt(plan,step,receiptId) {
  const visited=new Set();
  const visit=current=>{
    if(!current || visited.has(current.stepId))return false;
    visited.add(current.stepId);
    return current.dependsOn.some(d=>d.stepId===receiptId && ['PARSED','CONFIRMED'].includes(d.condition) ||
      visit(plan.steps.find(s=>s.stepId===d.stepId)));
  };
  return visit(step);
}

export function operationChainIssues(contract, plan) {
  const apps = contract.applications;
  const issues = [], keys = new Map(apps.map(a => [a.key,a]));
  for (const app of apps) {
    if (!Array.isArray(app.dependsOn) || app.dependsOn.length > 80 || app.dependsOn.some(d =>
      !d || Object.keys(d).sort().join(',') !== 'applicationKey,condition' || !keys.has(d.applicationKey) ||
      d.applicationKey === app.key || !['CONFIRMED','FAILED','SENT'].includes(d.condition)) ||
      new Set(app.dependsOn.map(d=>d.applicationKey)).size !== app.dependsOn.length) {
      issues.push('操作依赖引用无效'); continue;
    }
    const step = plan.exchangePlan.steps.find(s=>s.stepId===app.stepId);
    for (const dep of app.dependsOn) {
      const parent = keys.get(dep.applicationKey), before = plan.exchangePlan.steps.find(s=>s.stepId===parent.stepId);
      if (parent.stepId === app.stepId || before.businessTime.kind==='DATE' && step.businessTime.kind==='DATE' && before.businessTime.value > step.businessTime.value) issues.push('依赖操作不能在同一发送步骤或较晚日期');
    }
    if (app.accountIndex !== null && app.businessCode !== '001') {
      const opening = apps.find(a=>a.businessCode==='001' && a.accountIndex===app.accountIndex);
      if (!opening || !app.dependsOn.some(d=>d.applicationKey===opening.key && d.condition==='CONFIRMED')) issues.push('新账户操作必须依赖本账户开户成功确认');
    }
  }
  const active=new Set(),done=new Set();
  const visit=key=>{
    if(active.has(key))return false;
    if(done.has(key))return true;
    active.add(key);
    for(const d of keys.get(key)?.dependsOn??[])if(d && keys.has(d.applicationKey)&&!visit(d.applicationKey))return false;
    active.delete(key);done.add(key);return true;
  };
  if(!apps.every(a=>visit(a.key)))issues.push('操作依赖不能成环');
  return [...new Set(issues)];
}

export function operationTasks(plan) {
  const c=plan?.contract;
  if(!c)return [];
  const pending=[...c.applications],result=[],done=new Set();
  while(pending.length) {
    const index=pending.findIndex(a=>(a.dependsOn??[]).every(d=>done.has(d.applicationKey)));
    const app=pending.splice(index<0?0:index,1)[0], step=plan.exchangePlan.steps.find(s=>s.stepId===app.stepId);
    result.push({...app,fileType:step?.fileType,businessDate:step?.businessTime.value,
      name:operationName(step?.fileType,app.businessCode),canApply:canApplyOperation(step?.fileType,app.businessCode)});
    done.add(app.key);
  }
  return result;
}
