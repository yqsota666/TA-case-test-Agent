const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const text = v => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 300 && !/[\r\n]/.test(v);
export function exchangeError(code, message) { return Object.assign(new Error(message), { code, status: 409 }); }
export function validExchangePlan(plan) {
  if (!exact(plan,['status','steps','openQuestions']) || !['READY','UNPLANNED','NOT_REQUIRED'].includes(plan.status) ||
      !Array.isArray(plan.openQuestions) || plan.openQuestions.length > 30 || !plan.openQuestions.every(text) ||
      !Array.isArray(plan.steps) || plan.steps.length > 100) return false;
  if(plan.status==='NOT_REQUIRED')return plan.steps.length===0 && plan.openQuestions.length===0;
  if (plan.status === 'UNPLANNED') return plan.steps.length === 0 && plan.openQuestions.length > 0;
  if (!plan.steps.length || plan.openQuestions.length) return false;
  const steps = new Map();
  for (const s of plan.steps) {
    if (!exact(s,['stepId','roundId','direction','fileType','businessTime','required','dependsOn']) ||
        !id(s.stepId) || !id(s.roundId) || steps.has(s.stepId) || typeof s.required !== 'boolean' ||
        !(s.direction === 'SEND' ? ['01','03'] : s.direction === 'RECEIVE' ? ['02','04','05'] : []).includes(s.fileType) ||
        !exact(s.businessTime,['kind','value']) || !['DATE','RELATIVE'].includes(s.businessTime.kind) ||
        !text(s.businessTime.value) || (s.businessTime.kind === 'DATE' && !validDate(s.businessTime.value)) ||
        !Array.isArray(s.dependsOn) || s.dependsOn.length > 100 || !s.dependsOn.every(d =>
          exact(d,['stepId','condition']) && id(d.stepId) && ['SENT','PARSED','CONFIRMED'].includes(d.condition)) ||
        new Set(s.dependsOn.map(d => d.stepId)).size !== s.dependsOn.length) return false;
    steps.set(s.stepId,s);
  }
  for (const s of steps.values()) {
    for (const d of s.dependsOn) {
      const parent = steps.get(d.stepId);
      if (parent && parent.businessTime.kind==='DATE' && s.businessTime.kind==='DATE' && parent.businessTime.value>s.businessTime.value) return false;
      if (!parent || parent === s || (d.condition === 'SENT' ? parent.direction !== 'SEND' : parent.direction !== 'RECEIVE') ||
          (d.condition === 'CONFIRMED' && !['02','04'].includes(parent.fileType))) return false;
    }
    if (['02','04'].includes(s.fileType) && !s.dependsOn.some(d => {
      const p=steps.get(d.stepId); return d.condition==='SENT' && p.roundId===s.roundId && p.fileType===(s.fileType==='02'?'01':'03');
    })) return false;
  }
  const visiting = new Set(), visited = new Set();
  function visit(s) { if (visiting.has(s.stepId)) return false; if (visited.has(s.stepId)) return true;
    visiting.add(s.stepId); for(const d of s.dependsOn) if(!visit(steps.get(d.stepId))) return false;
    visiting.delete(s.stepId); visited.add(s.stepId); return true; }
  return [...steps.values()].every(visit);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const d=new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10).replaceAll('-','')===value;
}
export function validateExchangeOrder({ plan, stepId, direction, fileType, businessDate, completed=[] }) {
  if (!validExchangePlan(plan) || plan.status !== 'READY') throw exchangeError('EXCHANGE_PLAN_REQUIRED','当前 Plan 尚未规划文件时序，请先补充并确认计划');
  const step=plan.steps.find(s=>s.stepId===stepId);
  if (!step || step.direction!==direction || step.fileType!==fileType) throw exchangeError('EXCHANGE_STEP_MISMATCH','文件类型或方向不属于指定的计划步骤');
  if (step.businessTime.kind==='DATE' && step.businessTime.value!==businessDate) throw exchangeError('EXCHANGE_DATE_MISMATCH',`步骤 ${stepId} 要求业务日期 ${step.businessTime.value}`);
  const missing=step.dependsOn.filter(d=>!completed.some(e=>e.stepId===d.stepId && e.condition===d.condition));
  if (missing.length) throw Object.assign(exchangeError('ORDER_VIOLATION',`上传或发送顺序不符合已确认计划，缺少：${missing.map(d=>`${d.stepId}（${d.condition}）`).join('、')}。补齐后请重新提交当前步骤。`),{missing});
  return { step, duplicate: completed.some(e=>e.stepId===stepId && e.condition===(direction==='SEND'?'SENT':'PARSED')) };
}
