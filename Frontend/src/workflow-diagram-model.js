export const flowStages = [
  ['START','开始'], ['DISCUSSION','需求讨论'], ['CONFIRM_PLAN_DATA','确认准备数据'],
  ['CONFIRM_EXPECTATIONS','确认预期结果'], ['PREPARE_DATA','生成草稿'],
  ['CONFIRM_DRAFT','确认草稿'], ['DEFINE_EXCHANGE_ORDER','确认文件顺序'],
  ['FILE_EXCHANGE','文件交换'], ['EVALUATE_RESULT','核对结果'],
  ['CONFIRM_RESULT','确认测试结果'], ['CASE_FINAL','Case 结束'], ['CHAT_CLOSED','项目封存'],
];
export function diagramStates({workflow,caseStatus,plan,data}={}) {
  const stage=workflow?.stage;
  const index=flowStages.findIndex(([id])=>id===stage);
  const terminal=index>=10;
  const states=flowStages.map(([id,label],i)=>({id,label,status:i===index?'current':i<index?(terminal?'unknown':'done'):'pending'}));
  if(index<0)return states;
  states[0].status='done';
  // Terminal states can also be reached by force-closing a project. They do not prove earlier steps ran.
  if(terminal) {
    if(plan?.status==='LOCKED')for(const i of [1,2,3])states[i].status='done';
    if(data?.status==='VALIDATED')states[4].status='done';
    if(data?.reviewStatus==='CONFIRMED')states[5].status='done';
    if(['PASS','FAIL'].includes(caseStatus))states[10].status=index===10?'current':'done';
  }
  const proven=workflow?.proven;
  if(proven?.version===1) {
    for(const node of states) {
      if(node.status==='current')continue;
      if(proven.completedStages?.includes(node.id))node.status='done';
      else if(proven.notRequiredStages?.includes(node.id))node.status='skipped';
      else if(proven.partialStages?.includes(node.id))node.status='partial';
    }
  }
  if(index>7 && (workflow?.blockers?.length || workflow?.reviewIssues?.length) && !proven?.completedStages?.includes('FILE_EXCHANGE'))states[7].status='blocked';
  if(plan?.proposal?.exchangePlan?.status==='NOT_REQUIRED')for(const i of [6,7])states[i].status='skipped';
  return states;
}
