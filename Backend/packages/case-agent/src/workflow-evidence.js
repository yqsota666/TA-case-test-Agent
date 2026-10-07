// These flags describe recorded business actions, not progress inferred from a terminal stage.
export function workflowEvidence(facts){
 const completedStages=[],notRequiredStages=[],partialStages=[];
 const locked=facts.plan?.status==='LOCKED';
 const planVersion=Number(facts.plan?.version),review=facts.review;
 const currentReview=Boolean(review && Number(review.planVersion)===planVersion);
 const confirmed=currentReview && Boolean(review.confirmedAt) && ['PASS','FAIL'].includes(review.finalVerdict) && review.finalVerdict===facts.caseStatus;
 const result={evaluated:currentReview && (review.evidenceCurrent===true || facts.chatStatus!=='ACTIVE' || confirmed),confirmed,verdict:currentReview?review.finalVerdict??null:null};
 const order=facts.order;
 let exchangeSteps=[];
 if(locked && order && Number(order.version)===planVersion){
  completedStages.push('DEFINE_EXCHANGE_ORDER');
  exchangeSteps=order.plan.steps.map(step=>({stepId:step.stepId,fileType:step.fileType,required:step.required!==false,completed:order.events.some(event=>event.stepId===step.stepId && (step.direction==='SEND'?event.condition==='SENT':['APPLIED','CONFIRMED'].includes(event.condition)))}));
  const required=exchangeSteps.filter(step=>step.required);
  if(required.length && required.every(step=>step.completed))completedStages.push('FILE_EXCHANGE');
  else if(exchangeSteps.some(step=>step.completed))partialStages.push('FILE_EXCHANGE');
 }else if(locked && facts.plan.proposal?.exchangePlan?.status==='NOT_REQUIRED')notRequiredStages.push('DEFINE_EXCHANGE_ORDER','FILE_EXCHANGE');
 if(result.evaluated)completedStages.push('EVALUATE_RESULT');
 if(result.confirmed)completedStages.push('CONFIRM_RESULT');
 return {version:1,completedStages,notRequiredStages,partialStages,exchangeSteps,result};
}
