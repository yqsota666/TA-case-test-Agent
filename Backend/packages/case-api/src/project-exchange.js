import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const terminal = new Set(['PASS','FAIL']);
const groupKey = intent => [String(intent.channelId),intent.businessDate.replaceAll('-',''),intent.fileType,intent.wave??''].join(':');
function wave(plan,intent) {
 const application=plan?.contract?.applications?.find(a=>a.key===intent.key);
 const steps=plan?.exchangePlan?.steps??[];
 const signature=(id,seen=new Set())=>{if(seen.has(id))throw conflict('文件依赖不能成环。');const step=steps.find(s=>s.stepId===id);if(!step)throw conflict('已确认方案缺少文件依赖步骤。');const next=new Set([...seen,id]);return JSON.stringify([step.direction,step.fileType,step.businessTime])+'('+step.dependsOn.map(d=>d.condition+signature(d.stepId,next)).sort().join(',')+')';};
 return application?signature(application.stepId):'';
}
const serial=(scope,intent)=>'AI'+crypto.createHash('sha256').update(`${scope.casePublicId}:${scope.channelId}:${intent.key}`).digest('hex').slice(0,22);
const conflict = message => Object.assign(new Error(message),{code:'PROJECT_EXCHANGE_NOT_READY',status:409});

function flatRecords(result){return result.files.flatMap(file=>file.records.map((record,localIndex)=>({fileName:file.fileName,localIndex,record})));}
function mapRecordIndex(source,target,index){
 const record=flatRecords(source)[index];
 if(!record)throw conflict('回传记录序号无效。');
 const matches=flatRecords(target).map((r,i)=>({...r,index:i})).filter(r=>r.fileName===record.fileName&&r.localIndex===record.localIndex&&isDeepStrictEqual(r.record,record.record));
 if(matches.length!==1)throw conflict('同份回传的记录映射不一致，请重新上传。');
 return matches[0].index;
}

// All Case identities come from the authenticated project, never from client membership lists.
export function createProjectExchangeService({repository,preparations,exchangeRepository,applicationPreparation,returnParsing,returnConfirmation,applyAtomically}) {
  async function members(token,chatPublicId) {
    const result = await repository.listCases(token,chatPublicId);
    return result.cases;
  }
  async function applications(token,chatPublicId) {
    const cases = await members(token,chatPublicId);
    return Promise.all(cases.map(async item=>({casePublicId:item.public_id,status:item.status,
      ...(await exchangeRepository.listCaseApplications(token,{chatPublicId,casePublicId:item.public_id}))})));
  }
  async function readPreparation(token,scope) {
    const state = await preparations.read(token,scope);
    const own = await exchangeRepository.listCaseApplications(token,scope);
    const ids = new Set(own.applications.map(a=>a.batchPublicId).filter(Boolean));
    const files = (await exchangeRepository.listOutboundFiles(token,scope.chatPublicId)).files.filter(f=>ids.has(f.batchPublicId));
    return {...state,files};
  }
  async function prepare(input) {
    const cases = (await members(input.token,input.chatPublicId)).filter(c=>!terminal.has(c.status));
    if(!cases.some(c=>c.public_id===input.casePublicId))throw conflict('当前 Case 已结束，不能生成申请。');
    const cohort=[];
    for(const item of cases) {
      const scope={chatPublicId:input.chatPublicId,casePublicId:item.public_id};
      const plan=await repository.getLatestSopProposal(input.token,scope.chatPublicId,scope.casePublicId);
      const data=await repository.generatedData(input.token,scope.chatPublicId,scope.casePublicId);
      if(plan?.status!=='LOCKED'||data.reviewStatus!=='CONFIRMED') {
        const current=await preparations.read(input.token,input);
        if(input.revision!==undefined&&input.revision!==current.revision)throw conflict('申请内容已更新，请刷新后重试。');
        return preparations.save(input.token,{...input,revision:current.revision,state:{...current,phase:'WAITING_CHAT',questions:[],reply:'等待项目中其他 Case 确认方案与草稿后统一生成申请。'}});
      }
      if(plan.proposal.exchangePlan?.status!=='NOT_REQUIRED')cohort.push({...scope,plan:plan.proposal});
    }
    const states=[];
    for(const scope of cohort) {
      const own=scope.casePublicId===input.casePublicId;
      const state=await applicationPreparation.prepare({...scope,token:input.token,deferBatching:true,
        ...(own?{revision:input.revision,userInput:input.userInput,channelId:input.channelId}:{})});
      if(state.questions?.length)throw conflict('项目内仍有申请准备信息待补充，请查看对应 Case。');
      states.push({...scope,...state});
    }
    const all=await applications(input.token,input.chatPublicId);
    const relevant=all.filter(c=>cohort.some(s=>s.casePublicId===c.casePublicId));
    const groups=new Map();
    for(const member of relevant)for(const app of member.applications) {
      if(app.status!=='READY')continue;
      const state=states.find(s=>s.casePublicId===member.casePublicId);
      const intent=state?.intents.find(i=>serial(state,i)===app.applicationNumber);
      if(!intent)throw conflict('申请与已确认方案不一致，请重新检查对应 Case。');
      const key=groupKey({...app,wave:wave(state.plan,intent)});
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(app);
    }
    const batches=new Set(relevant.flatMap(c=>c.applications.filter(a=>a.status==='BATCHED').map(a=>a.batchPublicId)));
    for(const [key,ready] of groups) {
      const pending=states.some(s=>s.intents.some(intent=>groupKey({...intent,channelId:s.channelId,wave:wave(s.plan,intent)})===key&&!s.stagedKeys.includes(intent.key)));
      if(pending)continue;
      if(ready.length>1000)throw conflict('同组申请超过单批容量，请调整项目范围后重试。');
      const batch=await exchangeRepository.createOutboundBatch(input.token,{chatPublicId:input.chatPublicId,
        channelId:ready[0].channelId,businessDate:ready[0].businessDate,applicationPublicIds:ready.map(a=>a.publicId)});
      batches.add(batch.publicId);
    }
    for(const batchPublicId of batches)await exchangeRepository.generateOutboundFiles(input.token,{chatPublicId:input.chatPublicId,batchPublicId});
    for(const state of states) {
      const current=await readPreparation(input.token,state);
      await preparations.save(input.token,{...state,revision:current.revision,state:{...current,phase:current.waiting?.length?'WAITING_TA':current.files.length?'GENERATED':'WAITING_CHAT',reply:current.waiting?.length?'申请已统一生成，接收对应回传后继续。':current.files.length?'申请已统一生成，可以下载。':'等待同组 Case 准备完成后统一生成。'}});
    }
    return readPreparation(input.token,input);
  }
  async function batchMembers(token,input) {
    const all=await applications(token,input.chatPublicId);
    const result=all.filter(c=>c.applications.some(a=>a.batchPublicId===input.batchPublicId));
    if(!result.some(c=>c.casePublicId===input.casePublicId))throw conflict('当前 Case 不属于这份申请批次。');
    return result;
  }
  async function parse(token,input) {
    const outboundType=input.expectedType==='02'?'01':input.expectedType==='04'?'03':null;
    const group=(await batchMembers(token,input)).filter(member=>member.applications.some(a=>a.batchPublicId===input.batchPublicId&&a.fileType===outboundType));
    if(!group.some(member=>member.casePublicId===input.casePublicId))throw conflict('当前 Case 没有这类申请文件，不能接收对应回传。');
    if(terminal.has(group.find(m=>m.casePublicId===input.casePublicId)?.status))throw conflict('当前 Case 已结束，不能上传。');
    const results=[];
    for(const member of group) {
      if(terminal.has(member.status))continue;
      const local={...input,casePublicId:member.casePublicId};
      if(member.casePublicId!==input.casePublicId)delete local.exchangeStepId;
      const result=await returnParsing.parse(token,local);
      results.push({casePublicId:member.casePublicId,...result});
    }
    return {...results.find(r=>r.casePublicId===input.casePublicId),...(results.some(r=>r.phase==='ORDER_REJECTED')?{phase:'ORDER_REJECTED'}:{}),projectParses:results};
  }
  async function readConfirmation(token,scope) {
    const own=await returnConfirmation.read(token,scope);
    const parsing=await returnParsing.read(token,scope);
    const all=await applications(token,scope.chatPublicId);
    const batchIds=new Set(own.batches.map(b=>b.batchPublicId));
    const confirmations=[];
    for(const member of all.filter(c=>c.applications.some(a=>batchIds.has(a.batchPublicId)))) {
      const result=await returnConfirmation.read(token,{...scope,casePublicId:member.casePublicId});
      const other=await returnParsing.read(token,{...scope,casePublicId:member.casePublicId});
      for(const confirmation of result.confirmations) {
        const source=other.steps.flatMap(s=>s.parses.map(p=>({...p,batchPublicId:s.batchPublicId,expectedType:s.expectedType}))).find(p=>String(p.parseId)===String(confirmation.parseId));
        const view=source&&parsing.steps.find(s=>s.batchPublicId===source.batchPublicId&&s.expectedType===source.expectedType)?.parses.find(p=>p.result.sha256===source.result.sha256);
        if(view)confirmations.push({...confirmation,parseId:view.parseId,recordIndex:mapRecordIndex(source.result,view.result,confirmation.recordIndex)});
      }
    }
    return {...own,confirmations};
  }
  async function apply(token,input) {
    const own=await returnParsing.read(token,input);
    const step=own.steps.find(s=>s.parses.some(p=>String(p.parseId)===String(input.parseId)));
    if(!step)throw conflict('解析记录不属于当前 Case。');
    const source=step.parses.find(p=>String(p.parseId)===String(input.parseId));
    const group=await batchMembers(token,{...input,batchPublicId:step.batchPublicId});
    if(terminal.has(group.find(m=>m.casePublicId===input.casePublicId)?.status))throw conflict('当前 Case 已结束，不能同步。');
    if(!Array.isArray(input.recordIndexes)||!input.recordIndexes.length)throw conflict('请选择回传记录。');
    const selected=new Set(input.recordIndexes);
    if(selected.size!==input.recordIndexes.length)throw conflict('回传记录不能重复选择。');
    const records=source.result.files.flatMap(f=>f.records);
    if(input.recordIndexes.some(i=>!Number.isSafeInteger(i)||i<0||i>=records.length))throw conflict('回传记录序号无效。');
    const jobs=[];
    const routed=new Set();
    for(const member of group) {
      const matching=new Set(member.applications.filter(a=>a.batchPublicId===step.batchPublicId).map(a=>a.applicationNumber));
      const recordIndexes=input.recordIndexes.filter(i=>matching.has(records[i].AppSheetSerialNo));
      if(!recordIndexes.length)continue;
      const parsed=await returnParsing.read(token,{...input,casePublicId:member.casePublicId});
      if(terminal.has(member.status)){
        const historical=await returnConfirmation.read(token,{...input,casePublicId:member.casePublicId});
        for(const index of recordIndexes){
          const confirmed=historical.confirmations.some(c=>{const p=parsed.steps.flatMap(s=>s.parses).find(p=>String(p.parseId)===String(c.parseId));return p&&isDeepStrictEqual(flatRecords(p.result)[c.recordIndex]?.record,records[index]);});
          if(!confirmed)throw conflict('已结束 Case 的回传记录不能更改，请仅同步未完成 Case。');
          routed.add(index);
        }
        continue;
      }
      const target=parsed.steps.find(s=>s.batchPublicId===step.batchPublicId&&s.expectedType===step.expectedType)?.parses.find(p=>p.result.sha256===source.result.sha256&&p.orderAccepted);
      if(!target)throw conflict('项目内有 Case 尚未完成同份回传解析，请重新上传。');
      recordIndexes.forEach(i=>routed.add(i));
      const job={...input,casePublicId:member.casePublicId,parseId:target.parseId,recordIndexes:recordIndexes.map(i=>mapRecordIndex(source.result,target.result,i))};
      if(member.casePublicId!==input.casePublicId)delete job.exchangeStepId;
      jobs.push(job);
    }
    if(routed.size!==selected.size)throw conflict('回传包含未匹配本项目申请的记录，不能同步。');
    return jobs.length?applyAtomically(token,jobs):{businessApplied:true,projectResults:[],duplicate:true};
  }
  return {prepare,readPreparation,parse,readConfirmation,apply};
}
