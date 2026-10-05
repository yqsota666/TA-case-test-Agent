import {metadata,units} from '../platform/workflow-service.js';
import {encodeRecord} from '../../../../packages/platform-protocol/src/index.js';
import {reject} from './store.js';
import {componentSchemas} from './component-schema.js';

const automaticAccounts=new Set(['001','002','003','004','005','006','007','009']);
const automaticTransactions=new Set(['020','022','024','029','031','032','040','041','052']);
export function capability(fileType,businessCode) {
  const business=fileType==='01'?metadata.accountBusinesses[businessCode]:metadata.businesses[businessCode];
  if(!business)reject('业务类型不支持','CAPABILITY_UNSUPPORTED');
  return {fileType,businessCode,name:typeof business==='string'?business:business.name,
    confirmationType:fileType==='01'?'02':business.confirmationCode?'04':null,
    effectMode:businessCode==='070'?'NOTIFICATION':(fileType==='01'?automaticAccounts:automaticTransactions).has(businessCode)?'AUTOMATIC':'REVIEW',
    required:[...new Set([...(metadata.requirements[fileType].required??[]),...(metadata.requirements[fileType].requiredByBusiness?.[businessCode]??[])])]};
}

export function applicationFields(p) {
  const f={...p.fields};
  if(p.fundCode)Object.assign(f,{FundCode:p.fundCode,ShareClass:p.shareClass});
  if(['020','022','040','041'].includes(p.businessCode))f.CurrencyType??='156';
  if(['022','024'].includes(p.businessCode))f.ChargeType??='0';
  if(p.businessCode==='024')f.LargeRedemptionFlag??='0';
  return f;
}

export function validateApplicationContract(step) {
  const p=step.params,c=capability(p.fileType,p.businessCode),f=applicationFields(p);
  if(p.fileType==='03'&&c.required.includes('FundCode')&&!p.fundCode)reject('该业务必须使用明确的fundCode参数','PLAN_INVALID');
  if(['020','022','040','041'].includes(p.businessCode)&&(!p.amount||units(p.amount)<=0n))reject('该业务需要大于零的金额','PLAN_INVALID');
  if(['024','026','031','032','036'].includes(p.businessCode)&&(!p.volume||units(p.volume)<=0n))reject('该业务需要大于零的份额','PLAN_INVALID');
  if(p.negativeReason&&(!['022','024'].includes(p.businessCode)||p.fileType!=='03'
    ||(p.negativeReason==='NO_POSITION'&&p.businessCode!=='024')||(p.negativeReason==='NO_TA_ACCOUNT'&&p.businessCode!=='022')))
    reject('负向例外不适用于该业务','PLAN_INVALID');
  // Synthetic placeholders validate the protocol contract only; they never enter business facts.
  const record={...f,AppSheetSerialNo:'1',TransactionDate:p.businessDate.replaceAll('-',''),TransactionTime:'090000',
    TransactionAccountID:'1',DistributorCode:'305',BusinessCode:p.businessCode,BranchCode:'305',TAAccountID:'1',
    InvestorName:'Synthetic',IndividualOrInstitution:'1',CertificateType:'0',CertificateNo:'110101199001010015',
    ApplicationAmount:p.amount,ApplicationVol:p.volume};
  for(const key of Object.keys(p.fieldBindings))record[key]='1';
  const missing=c.required.filter(key=>record[key]==null||String(record[key]).trim()==='');
  if(missing.length)reject('计划业务必填字段缺失：'+missing.join('、'),'PLAN_INVALID');
  try{encodeRecord(p.fileType,record,'22');}catch(error){reject('计划协议字段不合法：'+error.message,'PLAN_INVALID');}
  return c;
}

export function capabilityCatalog() {
  return {components:Object.keys(componentSchemas),
    businesses:[...Object.keys(metadata.accountBusinesses).map(c=>capability('01',c)),...Object.keys(metadata.businesses).map(c=>capability('03',c))]};
}
