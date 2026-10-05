import {canonical,reject} from './store.js';
import {validateApplicationContract} from './capabilities.js';
import {fieldsForFile} from '../../../../packages/platform-protocol/src/index.js';

const resultFields=Object.fromEntries(['02','04'].map(type=>[type,new Set(['21','22'].flatMap(version=>
  fieldsForFile(version,type).map(field=>field.name)))]));

export function validateComponentPlan(plan,previous,started=[]) {
  completeFinalDependencies(plan);
  const byId=new Map(plan.steps.map(s=>[s.id,s]));
  if(byId.size!==plan.steps.length)reject('组件编号重复','PLAN_INVALID');
  const parents=ancestorLookup(byId);
  for(const step of plan.steps){
    const ancestry=parents(step.id);
    const ref=(id,kinds)=>{
      if(!ancestry.has(id)||!kinds.includes(byId.get(id)?.kind))reject('输出引用必须指向依赖中的正确组件：'+id,'PLAN_INVALID');
      return byId.get(id);
    };
    validateReferences(step,ref);
    if(step.kind==='application.prepare'){
      validateApplicationCoverage(step,plan,parents);
      validatePrerequisites(step,plan,parents);
    }
    if(['case.archive','case.evaluate'].includes(step.kind)){
      if(step.when)reject('最终判定不能是条件步骤','PLAN_INVALID');
      const required=plan.steps.filter(s=>s.id!==step.id&&s.kind!=='case.archive').map(s=>s.id);
      if(required.some(id=>!ancestry.has(id)))reject('最终判定必须依赖所有业务组件','PLAN_INCOMPLETE');
    }
  }
  const definitions=plan.steps.filter(s=>s.kind==='fund.define').map(s=>`${s.params.fundCode}:${s.params.shareClass}`);
  if(new Set(definitions).size!==definitions.length)reject('同一plan基金定义重复，请引用同一组件','PLAN_INVALID');
  for(const row of started.filter(r=>r.attempts>0||r.status==='SKIPPED')){
    if(canonical(previous?.steps.find(s=>s.id===row.step_key))!==canonical(byId.get(row.step_key)))
      reject('已经开始的组件必须原样保留，包括等待中的关联','PLAN_IMMUTABLE',409);
  }
  if(plan.steps.filter(s=>s.kind==='application.prepare').length>80)reject('当前运行最多80个申请，避免事实读取截断','PLAN_INVALID');
  const archives=plan.steps.filter(s=>s.kind==='case.archive');
  if(archives.length>1)reject('只能有一个最终归档组件','PLAN_INVALID');
  if(archives.length&&parents(archives[0].id).size!==plan.steps.length-1)reject('归档必须依赖完整plan的所有组件','PLAN_INVALID');
  return plan;
}

function completeFinalDependencies(plan) {
  const evaluations=plan.steps.filter(s=>s.kind==='case.evaluate');
  if(evaluations.length>1)reject('只能有一个最终评估组件','PLAN_INVALID');
  const [evaluation]=evaluations;
  if(evaluation){
    evaluation.dependsOn=[...new Set([...evaluation.dependsOn,...plan.steps.filter(s=>
      s.id!==evaluation.id&&s.kind!=='case.archive').map(s=>s.id)])];
    evaluation.allowSkippedDependencies=true;
  }
  for(const archive of plan.steps.filter(s=>s.kind==='case.archive')){
    if(evaluation)archive.dependsOn=[...new Set([...archive.dependsOn,evaluation.id])];
    archive.allowSkippedDependencies=true;
  }
}

function validatePrerequisites(step,plan,parents) {
  const p=step.params,ancestors=parents(step.id);
  if(p.fundCode&&!plan.steps.some(s=>s.kind==='fund.define'&&s.params.fundCode===p.fundCode
    &&s.params.shareClass===p.shareClass&&ancestors.has(s.id)))reject(`申请 ${step.id} 必须依赖基金 ${p.fundCode} 的定义组件`,'PLAN_INCOMPLETE');
  const needsOpening=p.fileType==='03'||p.businessCode!=='001';
  if(!needsOpening)return;
  const openings=plan.steps.filter(s=>s.kind==='application.prepare'&&s.params.fileType==='01'&&s.params.businessCode==='001'
    &&s.params.accountStepId===p.accountStepId).map(s=>s.id);
  const success=plan.steps.some(s=>s.kind==='result.validate'&&ancestors.has(s.id)
    &&s.params.expectations.some(e=>openings.includes(e.applicationStepId)&&e.outcome==='SUCCESS'));
  if(p.negativeReason==='NO_TA_ACCOUNT'){
    if(success)reject('无TA账户负向申请不能依赖成功开户','PLAN_INVALID');
  }else if(!success)reject(`申请 ${step.id} 必须依赖成功开户的结果验证`,'PLAN_INCOMPLETE');
}

function validateReferences(step,ref) {
  const p=step.params;
  if(step.when){
    const source=ref(step.when.receiveStepId,['return.receive']);
    if(!source.params.applicationStepIds?.includes(step.when.applicationStepId))reject('条件引用不属于该接收组件','PLAN_INVALID');
  }
  if(p.accountStepId)ref(p.accountStepId,['account.define']);
  if(step.kind==='account.define')ref(p.customerStepId,['customer.define']);
  if(step.kind==='data.validate')p.sourceStepIds.forEach(id=>ref(id,['customer.define','account.define','fund.define']));
  if(step.kind==='file.deliver')ref(p.fileStepId,['file.generate']);
  if(['file.generate','return.receive'].includes(step.kind)&&p.applicationStepIds){
    const apps=p.applicationStepIds.map(id=>ref(id,['application.prepare']));
    if(new Set(p.applicationStepIds).size!==apps.length)reject('申请集合不能重复','PLAN_INVALID');
    if(step.kind==='file.generate'&&new Set(apps.map(a=>a.params.fileType+':'+a.params.businessDate)).size!==1)
      reject('同一生成组件的申请须同类型同日期','PLAN_INVALID');
    if(step.kind==='return.receive'&&apps.some(a=>validateApplicationContract(a).confirmationType!==p.fileType))
      reject('接收文件类型与申请业务确认不符','PLAN_INVALID');
  }
  if(step.kind==='return.receive'){
    if(p.fileType==='05'?(!p.accountStepId||!p.fundCode||p.applicationStepIds):(!p.applicationStepIds||p.accountStepId||p.fundCode))
      reject('02/04接收引用申请；05接收引用账户和基金','PLAN_INVALID');
  }
  if(step.kind==='application.prepare')for(const b of Object.values(p.fieldBindings))
    ref(b.stepId,b.output==='appNo'?['application.prepare']:b.output==='taSerialNo'?['return.receive']:['account.define']);
  if(step.kind==='result.validate'){
    const source=ref(p.receiveStepId,['return.receive']);
    const allowed=resultFields[source.params.fileType];
    for(const expected of p.expectations)if(!source.params.applicationStepIds?.includes(expected.applicationStepId))
      reject('断言必须引用该接收组件的申请','PLAN_INVALID');
    for(const expected of p.expectations)for(const field of Object.keys(expected.fields))
      if(!allowed?.has(field))reject(`回传断言字段不属于${source.params.fileType}协议：${field}`,'PLAN_INVALID');
    if(new Set(p.expectations.map(e=>e.applicationStepId)).size!==p.expectations.length)reject('断言申请不能重复','PLAN_INVALID');
  }
}

function validateApplicationCoverage(step,plan,parents) {
  const c=validateApplicationContract(step);
  const generators=plan.steps.filter(s=>s.kind==='file.generate'&&s.params.applicationStepIds.includes(step.id));
  if(generators.length!==1)reject('每个申请必须由一个明确的文件组件生成','PLAN_INCOMPLETE');
  if(!c.confirmationType){
    if(!plan.steps.some(s=>s.kind==='file.deliver'&&s.params.fileStepId===generators[0].id))reject('无确认通知必须包含人工交付组件','PLAN_INCOMPLETE');
    return;
  }
  const receivers=plan.steps.filter(s=>s.kind==='return.receive'&&s.params.applicationStepIds?.includes(step.id));
  if(receivers.length!==1||!parents(receivers[0].id).has(generators[0].id))reject('申请必须有生成后的接收组件','PLAN_INCOMPLETE');
  const validations=plan.steps.filter(s=>s.kind==='result.validate'&&s.params.receiveStepId===receivers[0].id);
  if(validations.some(s=>s.when))reject('必需结果验证不能单独按条件跳过；请在申请组件上选择业务分支','PLAN_INVALID');
  const assertions=validations.flatMap(s=>s.params.expectations).filter(e=>e.applicationStepId===step.id),assertion=assertions[0];
  if(!assertion)reject('申请必须有明确的结果预期','PLAN_INCOMPLETE');
  if(assertions.some(e=>e.outcome!==assertion.outcome))reject('同一申请的业务结果预期不能矛盾','PLAN_INVALID');
  if(step.params.negativeReason&&assertion.outcome!=='FAILURE')reject('负向例外必须预期失败','PLAN_INVALID');
  if(c.effectMode==='REVIEW'&&assertion.outcome==='SUCCESS')
    reject('该业务成功后的本地效果仍需人工处理，当前不能自动闭环：'+c.name,'CAPABILITY_UNSUPPORTED');
}

export function ancestorLookup(byId) {
  const cache=new Map();
  function lookup(id,path=new Set()) {
    if(path.has(id))reject('计划依赖存在循环','PLAN_INVALID');
    if(cache.has(id))return cache.get(id);
    const next=new Set([...path,id]),out=new Set();
    for(const parent of byId.get(id)?.dependsOn??[]){
      if(!byId.has(parent)||parent===id)reject('计划依赖不存在或指向自身','PLAN_INVALID');
      out.add(parent);for(const a of lookup(parent,next))out.add(a);
    }
    cache.set(id,out);return out;
  }
  return lookup;
}
