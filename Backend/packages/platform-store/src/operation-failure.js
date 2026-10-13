import {operationSerial} from '../../case-agent/src/operation-chain-graph.js';

export function operationFailureBlockers({plan,order,applications,failures,necessaryStepIds}) {
  const apps=plan.contract.applications,blocked=new Map();
  const necessary=necessaryStepIds??new Set(order.plan.steps.filter(s=>s.required).map(s=>s.stepId));
  const sent=new Set((order.events??[]).filter(e=>e.condition==='SENT').map(e=>e.stepId));
  for(const failure of failures){
    const source=apps.find(a=>operationSerial({casePublicId:failure.casePublicId,channelId:failure.channelId,key:a.key})===JSON.parse(typeof failure.record==='string'?failure.record:JSON.stringify(failure.record)).AppSheetSerialNo);
    if(!source)continue;
    const affected=new Set();
    let changed=true;
    while(changed){changed=false;for(const a of apps){
      if(!sent.has(a.stepId)&&!affected.has(a.key)&&a.dependsOn.some(d=>affected.has(d.applicationKey)||d.applicationKey===source.key&&d.condition==='CONFIRMED')){affected.add(a.key);changed=true;}
    }}
    if(![...affected].some(key=>necessary.has(apps.find(a=>a.key===key).stepId)))continue;
    const stepIds=new Set(apps.filter(a=>affected.has(a.key)).map(a=>a.stepId));
    const entirelyBlocked=[...stepIds].filter(id=>apps.filter(a=>a.stepId===id).every(a=>affected.has(a.key)));
    const steps=new Set(entirelyBlocked);
    for(const s of order.plan.steps)if(s.direction==='RECEIVE'&&s.dependsOn.some(d=>steps.has(d.stepId)&&d.condition==='SENT'))steps.add(s.stepId);
    const record=typeof failure.record==='string'?JSON.parse(failure.record):failure.record;
    blocked.set(source.key,{failedStepId:failure.stepId,applicationId:failure.applicationId,parseId:failure.parseId,
      batchId:failure.batchId,channelId:failure.channelId,transactionAccountId:record.TransactionAccountID,returnCode:failure.returnCode,
      blockedApplicationKeys:[...affected],blockedStepIds:[...steps],blockedApplicationIds:applications.filter(a=>steps.has(a.stepId)).map(a=>a.applicationId)});
  }
  return [...blocked.values()];
}
