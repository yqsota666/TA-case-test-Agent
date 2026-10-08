// Merge equivalent independent rounds before deriving applications. Distinct
// dates, timing kinds and dependency gates remain distinct exchange operations.
export function consolidateExchangePlan(plan) {
  if(plan?.status!=='READY')return plan;
  const steps=structuredClone(plan.steps),aliases=new Map(),removed=new Set();
  const resolve=id=>aliases.get(id)??id;
  const dependencies=step=>[...new Map(step.dependsOn.map(d=>[JSON.stringify([resolve(d.stepId),d.condition]),{...d,stepId:resolve(d.stepId)}])).values()];
  for(const type of ['01','03']) {
    const groups=new Map();
    for(const send of steps.filter(s=>s.direction==='SEND'&&s.fileType===type)) {
      const receives=steps.filter(s=>s.direction==='RECEIVE'&&s.fileType===(type==='01'?'02':'04')&&s.roundId===send.roundId&&s.dependsOn.some(d=>d.stepId===send.stepId&&d.condition==='SENT'));
      if(receives.length!==1)continue;
      const receive=receives[0];
      const key=JSON.stringify([send.businessTime,send.required,dependencies(send).sort((a,b)=>a.stepId.localeCompare(b.stepId)),receive.businessTime,receive.required,dependencies(receive).filter(d=>d.stepId!==send.stepId).sort((a,b)=>a.stepId.localeCompare(b.stepId))]);
      const first=groups.get(key);
      if(!first){groups.set(key,{send,receive});continue;}
      if(first.send.dependsOn.some(d=>d.stepId===receive.stepId)||send.dependsOn.some(d=>d.stepId===first.receive.stepId))continue;
      aliases.set(send.stepId,first.send.stepId);aliases.set(receive.stepId,first.receive.stepId);
      removed.add(send.stepId);removed.add(receive.stepId);
    }
  }
  if(!removed.size)return plan;
  return {...plan,steps:steps.filter(s=>!removed.has(s.stepId)).map(s=>({...s,dependsOn:dependencies(s)}))};
}
