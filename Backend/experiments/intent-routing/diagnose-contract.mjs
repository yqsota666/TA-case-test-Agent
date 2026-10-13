import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validPlanContract,businessExpectationsFor,planContractValidationIssues} from '../../packages/platform-protocol/src/plan-contract.js';

const evidence=fileURLToPath(new URL('../../../.context/intent-routing/',import.meta.url));
const rows=JSON.parse(readFileSync(evidence+'end-to-end-results.json','utf8'));
if(existsSync(evidence+'end-to-end-complete-context.json'))rows.push(...JSON.parse(readFileSync(evidence+'end-to-end-complete-context.json','utf8')));
const diagnostics=[];
for(const row of rows.filter(r=>r.error?.code==='INVALID_PLAN_CONTRACT')){
  const last=row.trace.at(-1);
  let ctx=JSON.parse(last.request.user);
  while(ctx.input)ctx=typeof ctx.input==='string'?JSON.parse(ctx.input):ctx.input;
  const derived=JSON.parse(last.reply),plan=ctx.plan;
  const version=derived.applications.some(a=>a.dependsOn?.some(d=>d.condition==='ORDERED'))?4:3;
  const contract={version,protocolVersion:'22',dataSpecification:ctx.dataSpecification,...derived,businessExpectations:businessExpectationsFor(plan,derived.expectations)};
  const tests=contract.expectations.map((expectation,index)=>{
    const expectations=contract.expectations.filter((_,i)=>i!==index);
    const candidate={...contract,expectations,businessExpectations:businessExpectationsFor(plan,expectations)};
    return {removeOnlyForDiagnosis:index,field:expectation.field,expectedQuote:expectation.expectedQuote,valid:validPlanContract(candidate,plan),issues:planContractValidationIssues(candidate,plan)};
  });
  const steps=plan.exchangePlan.steps;
  const samePackageSendEdges=steps.flatMap(s=>s.direction==='SEND'?s.dependsOn.filter(d=>{
    const parent=steps.find(p=>p.stepId===d.stepId);
    return d.condition==='SENT'&&parent?.direction==='SEND'&&parent.roundId===s.roundId&&parent.businessTime.kind==='DATE'&&s.businessTime.kind==='DATE'&&parent.businessTime.value===s.businessTime.value;
  }).map(d=>({child:s.stepId,parent:d.stepId})):[]);
  const diagnosticPlan={...plan,exchangePlan:{...plan.exchangePlan,steps:steps.map(s=>({...s,dependsOn:s.dependsOn.filter(d=>!samePackageSendEdges.some(e=>e.child===s.stepId&&e.parent===d.stepId))}))}};
  diagnostics.push({id:row.id,method:row.method,attempt:row.attempt,valid:validPlanContract(contract,plan),issues:planContractValidationIssues(contract,plan),tests,
    samePackageSendEdgeDiagnostic:{edges:samePackageSendEdges,validAfterRemovingOnlyThesePlanEdges:validPlanContract(contract,diagnosticPlan),issuesAfterRemoving:planContractValidationIssues(contract,diagnosticPlan)},
    notice:'离线定位实验：逐项移除断言或同包发送依赖观察校验结果；不修改生产代码、原始模型产物或以删断言/依赖方式宣称修复。'});
}
writeFileSync(evidence+'contract-diagnosis.json',JSON.stringify(diagnostics,null,2));
console.log(JSON.stringify(diagnostics,null,2));
