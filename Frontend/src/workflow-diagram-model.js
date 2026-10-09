export const flowStages = [
  ['DISCUSSION','整理测试方案'], ['CONFIRM_PLAN_DATA','确认准备数据'],
  ['CONFIRM_EXPECTATIONS','确认预期'], ['APPLICATION_ZIP','生成完整申请ZIP'],
  ['TA_EXCHANGE','提交TA并接收回传'], ['RESULT','核对并确认测试结果'],
];
export function diagramStates({workflow,caseStatus,plan}={}) {
  const stage=workflow?.stage,proven=workflow?.proven;
  const completed=new Set(proven?.completedStages||[]);
  const terminal=['CASE_FINAL','CHAT_CLOSED'].includes(stage);
  const noFiles=plan?.proposal?.exchangePlan?.status==='NOT_REQUIRED';
  const tasks=workflow?.tasks||[];
  const zipReady=tasks.length>0&&tasks.every(t=>['GENERATED','DELIVERED','CONFIRMED','FAILED'].includes(t.state));
  const exchangeDone=completed.has('FILE_EXCHANGE');
  const sends=proven?.exchangeSteps?.filter(s=>['01','03'].includes(s.fileType))||[];
  const sent=sends.length>0&&sends.every(s=>s.completed);
  const partiallySent=sends.some(s=>s.completed);
  let index={DISCUSSION:0,CONFIRM_PLAN_DATA:1,CONFIRM_EXPECTATIONS:2,PREPARE_DATA:3,CONFIRM_DRAFT:3,DEFINE_EXCHANGE_ORDER:3,FILE_EXCHANGE:zipReady||partiallySent?4:3,EVALUATE_RESULT:5,CONFIRM_RESULT:5}[stage];
  const nodes=flowStages.map(([id,label],i)=>({id,label,status:index===i?'current':index!==undefined&&i<index?'done':terminal?'unknown':'pending'}));
  if(terminal){
    if(plan?.status==='LOCKED')for(const i of [0,1,2])nodes[i].status='done';
    if(zipReady||sent||exchangeDone)nodes[3].status='done';
    if(exchangeDone)nodes[4].status='done';
    if(completed.has('CONFIRM_RESULT')&&['PASS','FAIL'].includes(caseStatus))nodes[5].status='done';
  }
  if(index===4&&!zipReady&&!sent)nodes[3].status='partial';
  if(proven?.partialStages?.includes('FILE_EXCHANGE'))nodes[4].status=index===4?'current':'partial';
  if((workflow?.blockers?.length||workflow?.reviewIssues?.length)&&!exchangeDone)nodes[4].status='blocked';
  if(noFiles){
    if(index===3)nodes[3].label='准备测试数据';else nodes[3].status='skipped';
    nodes[4].status='skipped';
  }
  return nodes;
}
