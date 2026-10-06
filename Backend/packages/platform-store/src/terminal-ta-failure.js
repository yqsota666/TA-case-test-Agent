const json=value=>typeof value==='string'?JSON.parse(value):value;

// A failed receipt never satisfies CONFIRMED. This records why a required
// dependent application cannot execute, without inventing any future TA result.
export function deriveTerminalTaFailures({plan,order,applications,preparedAccounts=[],failures}) {
 const blockers=[];
 const accountFor=stepId=>{
  const specified=plan.contract?.applications.filter(a=>a.stepId===stepId);
  if(specified?.length){
   const accounts=new Set(specified.map(a=>a.transactionAccountId??preparedAccounts[a.accountIndex]?.transactionAccountId));
   return accounts.size===1?[...accounts][0]:null;
  }
  const existing=applications.filter(a=>a.stepId===stepId && a.fileType==='03');
  const accounts=new Set(existing.map(a=>json(a.record).TransactionAccountID).filter(Boolean));
  return accounts.size===1?[...accounts][0]:null;
 };
 for(const failed of failures){
  const step=order.plan.steps.find(s=>s.stepId===failed.stepId);
  if(!step || step.direction!=='RECEIVE' || !['02','04'].includes(step.fileType))continue;
  const account=json(failed.record).TransactionAccountID;
  if(!account || json(failed.confirmation).TransactionAccountID!==account)continue;
  const direct=order.plan.steps.filter(s=>s.required && s.direction==='SEND' && s.fileType==='03' &&
   accountFor(s.stepId)===account && s.dependsOn.some(d=>d.stepId===step.stepId && d.condition==='CONFIRMED') &&
   !order.events.some(e=>e.stepId===s.stepId && e.condition==='SENT'));
  if(!direct.length)continue;
  const blocked=new Set(direct.map(s=>s.stepId));
  let changed=true;
  while(changed){changed=false;for(const s of order.plan.steps){
   if(s.required && !(s.direction==='SEND' && s.fileType==='03' && accountFor(s.stepId)!==account) && !blocked.has(s.stepId) && s.dependsOn.some(d=>blocked.has(d.stepId)) &&
    !order.events.some(e=>e.stepId===s.stepId && e.condition===(s.direction==='SEND'?'SENT':'PARSED'))){blocked.add(s.stepId);changed=true;}
  }}
  blockers.push({failedStepId:step.stepId,applicationId:failed.applicationId,parseId:failed.parseId,
   batchId:failed.batchId,channelId:failed.channelId,transactionAccountId:account,returnCode:failed.returnCode,
   blockedStepIds:[...blocked].sort(),blockedApplicationIds:applications.filter(a=>blocked.has(a.stepId) && json(a.record).TransactionAccountID===account).map(a=>a.applicationId).filter(Boolean).sort()});
 }
 return blockers;
}

export function unresolvedTerminalTaFailures({plan,order,applications,preparedAccounts=[],failures}) {
 return failures.filter(f=>{
  const source=order.plan.steps.find(s=>s.stepId===f.stepId);
  if(!source || source.direction!=='RECEIVE' || !['02','04'].includes(source.fileType))return false;
  const account=json(f.record).TransactionAccountID;
  return order.plan.steps.some(s=>{
   if(!s.required || s.direction!=='SEND' || s.fileType!=='03' || !s.dependsOn.some(d=>d.stepId===f.stepId && d.condition==='CONFIRMED'))return false;
   const specified=plan.contract?.applications.filter(a=>a.stepId===s.stepId);
   const candidates=specified?.length?specified.map(a=>a.transactionAccountId??preparedAccounts[a.accountIndex]?.transactionAccountId):applications.filter(a=>a.stepId===s.stepId && a.fileType==='03').map(a=>json(a.record).TransactionAccountID);
   const accounts=new Set(candidates);
   return !accounts.size || accounts.has(undefined) || (accounts.size>1 && accounts.has(account));
  });
 }).map(f=>({failedStepId:f.stepId,applicationId:f.applicationId,parseId:f.parseId,reason:'无法唯一关联TA失败账户与必需后续申请；请澄清，不自动封存其他账户'}));
}

export async function terminalTaFailures(db,keys,{plan,order,preparedAccounts=[],write=false}) {
 const lock=write?' FOR UPDATE':'';
 const [failures]=await db.execute(`SELECT b.step_id AS stepId,CAST(a.id AS CHAR) AS applicationId,
  CAST(r.parse_id AS CHAR) AS parseId,CAST(b.batch_id AS CHAR) AS batchId,CAST(a.channel_id AS CHAR) AS channelId,
  a.record_json AS record,r.record_json AS confirmation,r.return_code AS returnCode
  FROM case_exchange_plan_bindings b JOIN case_exchange_plan_receipts p
   ON p.workspace_id=b.workspace_id AND p.chat_id=b.chat_id AND p.case_id=b.case_id AND p.plan_version=b.plan_version AND p.step_id=b.step_id
  JOIN batch_applications ba ON ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.batch_id
  JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id AND a.case_id=b.case_id
  JOIN sales_return_confirmations r ON r.workspace_id=a.workspace_id AND r.chat_id=a.chat_id AND r.case_id=a.case_id AND r.application_id=a.id AND r.parse_id=p.parse_id
  WHERE b.workspace_id=? AND b.chat_id=? AND b.case_id=? AND b.plan_version=?
   AND a.status='FAILED' AND r.outcome='FAILED' AND ((b.file_type='02' AND a.file_type='01') OR (b.file_type='04' AND a.file_type='03')) LIMIT 501${lock}`,[...keys,order.version]);
 const [applications]=await db.execute(`SELECT b.step_id AS stepId,CAST(a.id AS CHAR) AS applicationId,a.file_type AS fileType,a.record_json AS record
  FROM case_exchange_plan_bindings b JOIN batch_applications ba ON ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.batch_id
  JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id AND a.case_id=b.case_id
  WHERE b.workspace_id=? AND b.chat_id=? AND b.case_id=? AND b.plan_version=? AND b.file_type=a.file_type LIMIT 501${lock}`,[...keys,order.version]);
 const context={plan,order,applications,preparedAccounts,failures};
 return {blockers:deriveTerminalTaFailures(context),unresolvedFailures:unresolvedTerminalTaFailures(context)};
}
