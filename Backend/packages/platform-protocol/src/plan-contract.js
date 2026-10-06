import { hasNumericFieldExpectation, hasLiteralExpectation, numericQuoteBindings, preciseDecimal } from './numeric-expectations.js';
import { validDate } from './exchange-plan.js';
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max = 1000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const list = (v, max, check) => Array.isArray(v) && v.length <= max && v.every(check);
const money = v => typeof v === 'string' && /^\d{1,14}\.\d{2}$/.test(v);
const volume = v => typeof v === 'string' && /^\d{1,10}\.\d{8}$/.test(v);
const code = v => typeof v === 'string' && /^\d{6}$/.test(v);
const index = v => Number.isSafeInteger(v) && v >= 0;
export const RESULT_FIELDS = Object.freeze({
  APPLICATION_CONFIRMATION: ['status','returnCode','confirmedAmount','confirmedVolume','taAccountId'],
  FORMAL_ACCOUNT: ['transactionAccountId','taAccountId','branchCode'],
  CURRENT_FORMAL_HOLDING: ['totalVolume','availableVolume','frozenVolume','snapshotDate'],
});
export function validPlanContract(c, plan) {
  if (!exact(c, ['version','protocolVersion','dataSpecification','assumptions','expectations','applications','missing']) || c.version !== 1 || c.protocolVersion!=='22' || !Array.isArray(plan?.scenarios) || !plan.scenarios.length ||
      !list(c.assumptions,50,v=>text(v)) || !list(c.missing,50,v=>text(v))) return false;
  const d=c.dataSpecification;
  return validDataSpecification(d) && validApplications(c,d,plan) && validExpectations(c,d,plan);
}

function validDataSpecification(d) {
  if (!exact(d,['customers','accounts','funds','holdings','missing']) || !list(d.missing,30,v=>text(v,200)) ||
      !list(d.customers,50,r=>exact(r,['name','investorType','simulatedBalance']) && text(r.name,180) && ['0','1'].includes(r.investorType) && money(r.simulatedBalance)) ||
      !list(d.accounts,100,r=>exact(r,['customerIndex','branchCode']) && index(r.customerIndex) && r.customerIndex<d.customers.length && typeof r.branchCode==='string' && /^\d{1,9}$/.test(r.branchCode)) ||
      !list(d.funds,50,r=>exact(r,['fundCode','fundName','shareClass','nav']) && code(r.fundCode) && text(r.fundName,200) && typeof r.shareClass==='string' && /^[A-Z0-9]$/.test(r.shareClass) && typeof r.nav==='string' && /^\d{1,8}\.\d{8}$/.test(r.nav)) ||
      !list(d.holdings,200,r=>exact(r,['accountIndex','fundIndex','totalVolume']) && index(r.accountIndex) && r.accountIndex<d.accounts.length && index(r.fundIndex) && r.fundIndex<d.funds.length && volume(r.totalVolume))) return false;
  if (new Set(d.funds.map(f=>f.fundCode+':'+f.shareClass)).size!==d.funds.length ||
      new Set(d.holdings.map(h=>h.accountIndex+':'+h.fundIndex)).size!==d.holdings.length) return false;
  return true;
}

function validApplications(c,d,plan) {
  if (!list(c.applications,80,a=>{
    if (!exact(a,['key','stepId','businessCode','accountIndex','transactionAccountId','fundIndex','fields']) ||
        typeof a.key!=='string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(a.key) || typeof a.stepId!=='string' ||
        !((index(a.accountIndex) && a.accountIndex<d.accounts.length && a.transactionAccountId===null) ||
          (a.accountIndex===null && typeof a.transactionAccountId==='string' && /^\d{1,17}$/.test(a.transactionAccountId))) ||
        !(a.fundIndex===null || (index(a.fundIndex) && a.fundIndex<d.funds.length)) ||
        !a.fields || typeof a.fields!=='object' || Array.isArray(a.fields) || Object.keys(a.fields).length>100 ||
        !Object.entries(a.fields).every(([k,v])=>/^[A-Za-z][A-Za-z0-9]{0,49}$/.test(k) && typeof v==='string' && v.length<=500)) return false;
    const step=plan.exchangePlan?.steps.find(s=>s.stepId===a.stepId);
    if(!step || step.direction!=='SEND' || step.businessTime.kind!=='DATE' ||
       !((step.fileType==='01' && a.businessCode==='001' && a.fundIndex===null) ||
         (step.fileType==='03' && a.businessCode==='022' && a.fundIndex!==null))) return false;
    if(step.fileType==='03' && !money(a.fields.ApplicationAmount))return false;
    const owned=['AppSheetSerialNo','TransactionAccountID','DistributorCode','BusinessCode','BranchCode','InvestorName','IndividualOrInstitution','TAAccountID','FundCode','ShareClass','TransactionDate'];
    return !Object.keys(a.fields).some(k=>owned.includes(k));
  }) || new Set(c.applications.map(a=>a.key)).size!==c.applications.length) return false;
  for(const a of c.applications){
    const step=plan.exchangePlan.steps.find(s=>s.stepId===a.stepId);
    if(step.fileType==='01' && a.transactionAccountId!==null)return false;
    if(step.fileType==='03' && a.accountIndex!==null){
      const opening=c.applications.find(o=>o.businessCode==='001' && o.accountIndex===a.accountIndex);
      const openStep=opening && plan.exchangePlan.steps.find(s=>s.stepId===opening.stepId);
      const receipt=openStep && plan.exchangePlan.steps.find(s=>s.fileType==='02' && s.roundId===openStep.roundId);
      if(!receipt || !step.dependsOn.some(d=>d.stepId===receipt.stepId && d.condition==='CONFIRMED'))return false;
    }
  }
  if (!c.missing.length && plan.exchangePlan?.steps.some(s=>s.direction==='SEND' && !c.applications.some(a=>a.stepId===s.stepId))) return false;
  return true;
}

function validExpectations(c,d,plan) {
  if (!list(c.expectations,300,a=>{
    if (!exact(a,['scenarioIndex','expectedQuote','source','selector','field','operator','expectedValue']) ||
        !index(a.scenarioIndex) || !plan?.scenarios?.[a.scenarioIndex] || !text(a.expectedQuote) ||
        !plan.scenarios[a.scenarioIndex].expected.includes(a.expectedQuote) ||
        !Object.hasOwn(RESULT_FIELDS,a.source) || !RESULT_FIELDS[a.source].includes(a.field) || !['eq','gte','lte'].includes(a.operator) || !text(a.expectedValue,100)) return false;
    const s=a.selector;
    if (!exact(s,['accountIndex','transactionAccountId','channelId','fundCode','shareClass','fileType','businessDate']) ||
        !((index(s.accountIndex) && s.accountIndex<d.accounts.length && s.transactionAccountId===null) ||
          (s.accountIndex===null && typeof s.transactionAccountId==='string' && /^\d{1,17}$/.test(s.transactionAccountId))) ||
        !(s.channelId===null || (typeof s.channelId==='string' && /^[1-9]\d{0,18}$/.test(s.channelId))) ||
        !(s.fundCode===null || code(s.fundCode)) || !(s.shareClass===null || (typeof s.shareClass==='string' && /^[A-Z0-9]$/.test(s.shareClass))) ||
        !(s.fileType===null || ['01','03'].includes(s.fileType)) || !(s.businessDate===null || validDate(s.businessDate))) return false;
    if (a.source==='CURRENT_FORMAL_HOLDING' && (!s.fundCode || !s.shareClass || s.fileType!==null || s.businessDate!==null)) return false;
    if (a.source==='FORMAL_ACCOUNT' && [s.fundCode,s.shareClass,s.fileType,s.businessDate].some(v=>v!==null))return false;
    if (a.source==='APPLICATION_CONFIRMATION') {
      if (!s.fileType || !s.businessDate || !c.applications.some(application=>{
        const step=plan.exchangePlan.steps.find(step=>step.stepId===application.stepId);
        const fund=application.fundIndex===null?null:d.funds[application.fundIndex];
        return step.fileType===s.fileType && step.businessTime.value===s.businessDate &&
          application.accountIndex===s.accountIndex && application.transactionAccountId===s.transactionAccountId &&
          (s.fundCode===null || fund?.fundCode===s.fundCode) && (s.shareClass===null || fund?.shareClass===s.shareClass);
      })) return false;
    }
    if (['confirmedAmount','confirmedVolume','totalVolume','availableVolume','frozenVolume'].includes(a.field)) {
      if (!hasNumericFieldExpectation(a.field,a.expectedValue,a.expectedQuote,a.operator)) return false;
    } else if (a.operator!=='eq' || !hasLiteralExpectation(a.expectedValue,a.expectedQuote)) return false;
    if (a.operator==='gte' && !/(至少|不低于|不少于|大于等于|>=|≥)/.test(a.expectedQuote)) return false;
    if (a.operator==='lte' && !/(最多|不高于|不超过|不多于|小于等于|<=|≤)/.test(a.expectedQuote)) return false;
    return true;
  })) return false;
  return c.missing.length>0 || plan.scenarios.every((scenario,i)=>{
    const assertions=c.expectations.filter(a=>a.scenarioIndex===i);
    return assertions.length>0 && numericQuoteBindings(scenario.expected).every(binding=>assertions.some(a=>
      a.field===binding.field && a.operator===binding.operator && preciseDecimal(a.expectedValue)===preciseDecimal(binding.value)));
  });
}
