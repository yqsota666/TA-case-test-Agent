import {DataSpecificationSchema} from '../../case-agent/src/data-generation.js';
import {validatePlanApplications} from '../../case-agent/src/plan-contract.js';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';
const fail=(code,status,message)=>Object.assign(new Error(message),{code,status});
export async function revisePreparedPlanData({repository,admit,token,chatPublicId,casePublicId,body}) {
  if(!body || Object.keys(body).sort().join(',')!=='dataSpecification,versionNumber' || !Number.isSafeInteger(body.versionNumber) || body.versionNumber<1)
    throw fail('INVALID_INPUT',400,'修改内容或版本无效');
  const parsed=DataSpecificationSchema.safeParse(body.dataSpecification);
  if(!parsed.success)throw fail('DATA_EDIT_INVALID',422,'请检查必填字段、金额和代码格式');
  const current=await repository.getLatestSopProposal(token,chatPublicId,casePublicId);
  if(!current || current.versionNumber!==body.versionNumber || current.status!=='PENDING_CONFIRMATION')throw fail('STALE_PLAN',409,'方案已更新或锁定，请刷新后再修改');
  if(!current.proposal.contract)throw fail('PLAN_CONTRACT_REQUIRED',409,'当前方案没有准备数据');
  if(admit)await admit({token,chatPublicId,casePublicId,text:JSON.stringify(parsed.data),purpose:'PLAN_DATA_EDIT'});
  const proposal=structuredClone(current.proposal);
  proposal.contract.dataSpecification=parsed.data;
  if(!validPlanContract(proposal.contract,proposal))throw fail('DATA_EDIT_INVALID',422,'修改后的客户、账户、基金或持仓关联不符合方案，请检查对应记录');
  proposal.contract=validatePlanApplications(proposal,proposal.contract);
  if(proposal.contract.missing.length)throw fail('DATA_EDIT_INVALID',422,proposal.contract.missing.join('；'));
  await repository.saveSopProposal(token,chatPublicId,casePublicId,proposal,{expectedVersion:body.versionNumber});
  return repository.getLatestSopProposal(token,chatPublicId,casePublicId);
}
