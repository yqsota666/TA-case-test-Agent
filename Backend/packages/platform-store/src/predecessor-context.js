import {storeError} from './index.js';
const json=value=>typeof value==='string'?JSON.parse(value):value;
export async function readPredecessorContext(db,keys,predecessorId){
 if(!predecessorId)return null;
 const [[source]]=await db.execute('SELECT public_id,title,status FROM cases WHERE workspace_id=? AND chat_id=? AND id=?',[...keys,predecessorId]);
 if(!source||source.status!=='FAIL')throw storeError('PREDECESSOR_NOT_FAILED',409,'关联来源须是同父Chat已失败Case');
 const scope=[...keys,predecessorId];
 const [[planRow]]=await db.execute('SELECT version_number,plan_json FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY version_number DESC LIMIT 1',scope);
 const [[review]]=await db.execute(`SELECT CAST(id AS CHAR) AS reviewId,evidence_sha256,evidence_json,suggestion_json,confirmation_reason FROM case_result_reviews WHERE workspace_id=? AND chat_id=? AND case_id=? AND final_verdict='FAIL' ORDER BY id DESC LIMIT 1`,scope);
 if(!review)throw storeError('PREDECESSOR_NOT_FAILED',409,'关联来源缺少人工最终失败记录');
 const proposal=planRow&&json(planRow.plan_json),snapshot=json(review.evidence_json),suggestion=json(review.suggestion_json);
 const originalPlan=proposal?{objective:proposal.objective,preconditions:proposal.preconditions?.slice(0,20),scenarios:proposal.scenarios?.slice(0,10),openQuestions:proposal.openQuestions?.slice(0,20),exchangePlan:proposal.exchangePlan?{...proposal.exchangePlan,steps:proposal.exchangePlan.steps.slice(0,20)}:undefined,contractExpectations:proposal.contract?.expectations?.slice(0,20)}:null;
 const context={casePublicId:source.public_id,title:source.title,status:'FAIL',planVersion:planRow?.version_number??null,originalPlan,reviewId:review.reviewId,evidenceSha256:review.evidence_sha256,humanFailureReason:review.confirmation_reason,suggestion,evidence:(snapshot.evidence??[]).slice(0,20),evidenceCount:snapshot.evidence?.length??0,originalScenarioCount:proposal?.scenarios?.length??0,contextIsReadOnly:true};
 if(Buffer.byteLength(JSON.stringify(context))>80000)context.suggestion={outcome:suggestion.outcome,note:'建议详情过长，请查看来源Case完整结果'};
 if(Buffer.byteLength(JSON.stringify(context))>80000){if(context.originalPlan)context.originalPlan.scenarios=context.originalPlan.scenarios.slice(0,5);context.evidence=context.evidence.slice(0,5);}
 if(Buffer.byteLength(JSON.stringify(context))>80000){context.originalPlan=null;context.evidence=[];context.truncated=true;}
 context.truncated=Boolean(context.truncated)||context.evidenceCount>context.evidence.length||context.originalScenarioCount>(context.originalPlan?.scenarios?.length??0)||Buffer.byteLength(JSON.stringify(suggestion))>Buffer.byteLength(JSON.stringify(context.suggestion));
 return context;
}
