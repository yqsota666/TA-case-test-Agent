import {FILE_DEFINITIONS,FIELD_REQUIREMENTS} from '../../../../packages/platform-protocol/src/definitions.js';
import {TRANSACTION_BUSINESSES} from '../../../../packages/platform-protocol/src/businesses.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=/^[a-z][a-z0-9_]{0,39}$/;
const date=/^\d{4}-\d{2}-\d{2}$/;
const account=/^\d{1,20}$/;
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const decimal=value=>typeof value==='string'&&/^\d{1,14}(?:\.\d{1,2})?$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fieldNames=Object.fromEntries(['01','03','02','04'].map(type=>[type,new Set(FILE_DEFINITIONS[type].map(f=>f.name))]));

export class SopError extends Error {
  constructor(message,code='SOP_INVALID'){super(message);this.code=code;this.status=400;}
}
const invalid=(message,code)=>{throw new SopError(message,code);};
const validDate=value=>date.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  &&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const assertFields=(fields,allowed,label)=>{
  if(!object(fields))invalid(`${label}字段必须是对象`);
  for(const [name,value]of Object.entries(fields))
    if(!allowed.has(name)||typeof value!=='string')invalid(`${label}字段无效：${name}`);
};

// Drafts may name data needs before the global account exists. Approval requires
// concrete account IDs and observable assertions for every action.
export function validateSop(input,{approve=false}={}) {
  if(!object(input)||!text(input.objective,1200)||!Array.isArray(input.actions)||input.actions.length<1||input.actions.length>80)
    invalid('SOP 必须有测试目标和 1–80 个动作');
  if(!Array.isArray(input.dataNeeds)||input.dataNeeds.some(v=>!text(v,300)))invalid('数据需求格式无效');
  const ids=new Set();
  for(const action of input.actions){
    if(!object(action)||!id.test(action.id??'')||ids.has(action.id))invalid('SOP 动作编号无效或重复');
    ids.add(action.id);
    if(!['01','03'].includes(action.fileType)||!validDate(action.businessDate))invalid(`动作 ${action.id} 的文件类型或业务日无效`);
    if(action.fileType==='01'?!['001','002','003','004','005','006','007','008','009'].includes(action.businessCode):!TRANSACTION_BUSINESSES[action.businessCode])
      invalid(`动作 ${action.id} 的业务代码不支持`);
    if(action.tradingAccountId!=null&&!account.test(String(action.tradingAccountId)))invalid(`动作 ${action.id} 的交易账户无效`);
    if(approve&&!account.test(String(action.tradingAccountId??'')))invalid(`动作 ${action.id} 尚未绑定全局交易账户`,'SOP_DATA_MISSING');
    if(action.applicationAmount!=null&&!decimal(action.applicationAmount))invalid(`动作 ${action.id} 的申请金额无效`);
    if(action.applicationVolume!=null&&!decimal(action.applicationVolume))invalid(`动作 ${action.id} 的申请份额无效`);
    if(action.testMode!=null&&!['NORMAL','NEGATIVE'].includes(action.testMode))invalid(`动作 ${action.id} 的测试模式无效`);
    assertFields(action.fields??{},fieldNames[action.fileType],`动作 ${action.id} 的申请`);
    if(approve&&action.fileType==='03'){
      const supplied=new Set(Object.keys(action.fields??{}));
      if(action.applicationAmount)supplied.add('ApplicationAmount');
      if(action.applicationVolume)supplied.add('ApplicationVol');
      const generated=new Set(['AppSheetSerialNo','TransactionDate','TransactionTime','TransactionAccountID',
        'DistributorCode','BusinessCode','TAAccountID','BranchCode']);
      const missing=(FIELD_REQUIREMENTS['03'].requiredByBusiness[action.businessCode]??[])
        .filter(name=>!supplied.has(name)&&!generated.has(name));
      if(missing.length)invalid(`动作 ${action.id} 缺少 03 必填字段：${missing.join('、')}`,'SOP_DATA_MISSING');
    }
    if(!Array.isArray(action.dependsOn)||action.dependsOn.some(dep=>!object(dep)||!id.test(dep.actionId??'')||(dep.caseId!=null&&!uuid.test(dep.caseId))))
      invalid(`动作 ${action.id} 的依赖格式无效`);
    const expectedType=action.fileType==='01'?'02':'04',expected=action.expected;
    if(!object(expected)||!['SUCCESS','FAILURE'].includes(expected.outcome))invalid(`动作 ${action.id} 缺少可观察的 02/04 结果标准`);
    if(!Array.isArray(expected.returnCodes)||expected.returnCodes.some(code=>!/^\w{4}$/.test(code)))invalid(`动作 ${action.id} 的返回码标准无效`);
    assertFields(expected.fields??{},fieldNames[expectedType],`动作 ${action.id} 的${expectedType}断言`);
    if(action.evidence05!=null){
      const e=action.evidence05;
      if(!object(e)||!/^\d{6}$/.test(e.fundCode??'')||typeof e.shareClass!=='string'||e.shareClass.length!==1
        ||!decimal(e.totalVolume))invalid(`动作 ${action.id} 的 05 证据标准无效`);
    }
    if(approve&&!text(action.successVisibleAs,500))invalid(`动作 ${action.id} 必须说明成功时能看到什么`,'SOP_EXPECTATION_MISSING');
  }
  for(const action of input.actions)for(const dep of action.dependsOn)
    if(!dep.caseId&&!ids.has(dep.actionId))invalid(`动作 ${action.id} 引用了不存在的本 Case 动作`);
  return structuredClone(input);
}

export const actionKey=(caseId,actionId)=>`${caseId}:${actionId}`;

export function planRound(cases,applicationRows,accountRows=[]) {
  const active=new Map(),state=new Map(),accounts=new Map(accountRows.map(r=>[String(r.id),r]));
  for(const row of applicationRows)state.set(actionKey(row.caseId,row.actionId),row);
  for(const c of cases){
    if(c.status!=='APPROVED')invalid(`Case ${c.caseId} 的 SOP 未确认，整批不能生成`,'SOP_NOT_APPROVED');
    for(const action of c.sop.actions){
      const key=actionKey(c.caseId,action.id);
      if(active.has(key))invalid(`重复的 Case 动作：${key}`);
      active.set(key,{caseId:c.caseId,version:c.version,action});
    }
  }
  const ready=[],waiting=[],done=[];
  for(const [key,item]of active){
    const {caseId,action}=item,prior=state.get(key);
    if(prior){done.push({...item,status:prior.status,outcome:prior.outcome??null});continue;}
    const caseVerdict=cases.find(c=>c.caseId===caseId)?.assessment?.verdict;
    if(['PASS','FAIL','REVIEW'].includes(caseVerdict)){
      waiting.push({...item,reason:caseVerdict==='REVIEW'?'CASE_REVIEW':'CASE_DECIDED'});continue;
    }
    const dependencies=action.dependsOn.map(dep=>{
      const target=actionKey(dep.caseId??caseId,dep.actionId);
      if(!active.has(target))invalid(`动作 ${key} 引用了不存在的动作 ${target}`);
      return {key:target,result:state.get(target)};
    });
    const missing=dependencies.filter(dep=>dep.result?.verificationStatus!=='PASS');
    if(missing.length){waiting.push({...item,reason:missing.some(d=>d.result?.verificationStatus==='FAIL')?
      'DEPENDENCY_FAILED':missing.some(d=>d.result?.verificationStatus==='REVIEW')?'DEPENDENCY_REVIEW':'DEPENDENCY',
      dependsOn:missing.map(d=>d.key)});continue;}
    const accountState=accounts.get(String(action.tradingAccountId));
    if(!accountState)invalid(`动作 ${key} 的共享交易账户不存在`,'SOP_DATA_MISSING');
    if(action.fileType==='03'&&accountState.status!=='ACTIVE'&&action.expected.outcome==='SUCCESS'){
      waiting.push({...item,reason:'ACCOUNT_NOT_CONFIRMED'});continue;
    }
    ready.push(item);
  }
  return {ready,waiting,done,maxPlannedRounds:plannedRounds(active)};
}

export function summarizeCaseLoop(cases,round){
  const items=cases.map(c=>{
    const verdict=c.assessment?.verdict??'WAITING';
    const ready=round.ready.filter(a=>a.caseId===c.caseId).map(a=>a.action.id);
    const waiting=round.waiting.filter(a=>a.caseId===c.caseId).map(a=>({actionId:a.action.id,reason:a.reason}));
    return {caseId:c.caseId,verdict,ready,waiting};
  });
  const allDecided=items.every(c=>['PASS','FAIL'].includes(c.verdict));
  const allPassed=items.every(c=>c.verdict==='PASS');
  const phase=allDecided?(allPassed?'ALL_PASS':'COMPLETE_WITH_FAILURE'):
    round.ready.length?'READY_TO_GENERATE':items.some(c=>c.verdict==='REVIEW')?'REVIEW_REQUIRED':
      round.waiting.some(a=>a.reason==='DEPENDENCY_FAILED')?'BLOCKED_DEPENDENCY':'WAITING_FOR_RETURN';
  return {phase,allDecided,allPassed,maxPlannedRounds:round.maxPlannedRounds,cases:items};
}

function plannedRounds(active) {
  const memo=new Map(),visiting=new Set();
  const depth=key=>{
    if(memo.has(key))return memo.get(key);
    if(visiting.has(key))invalid('SOP 动作依赖存在循环');
    const item=active.get(key);
    if(!item)invalid(`依赖的动作不存在：${key}`);
    visiting.add(key);
    const value=1+Math.max(0,...item.action.dependsOn.map(dep=>depth(actionKey(dep.caseId??item.caseId,dep.actionId))));
    visiting.delete(key);memo.set(key,value);return value;
  };
  return Math.max(0,...active.keys().map(depth));
}
