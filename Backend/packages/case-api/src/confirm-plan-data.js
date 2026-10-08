import {dataExchangeRequirementIssues} from '../../platform-protocol/src/data-exchange-requirements.js';
export function createConfirmPlanWithData({ repository, confirm, executeData }) {
  return async ({ token, chatPublicId, casePublicId, versionNumber, section }) => {
    const pending = await repository.getLatestSopProposal(token, chatPublicId, casePublicId);
    if (!pending || !['PENDING_CONFIRMATION','LOCKED'].includes(pending.status) || pending.versionNumber!==versionNumber) {
      throw Object.assign(new Error('请先审阅最新的Plan'),{code:'STALE_PLAN',status:409});
    }
    if (!['DATA','EXPECTATIONS'].includes(section)) throw Object.assign(new Error('请分别确认准备数据和预期结果'),{code:'PLAN_SECTION_REQUIRED',status:400});
    if (!pending.proposal.contract) throw Object.assign(new Error('请重新生成带严格结构的Plan'),{code:'PLAN_CONTRACT_REQUIRED',status:409});
    const issues=dataExchangeRequirementIssues(pending.proposal);
    if(issues.length)throw Object.assign(new Error(issues.join('；')),{code:'DATA_EXCHANGE_REQUIRED',status:409});
    if (pending.status==='PENDING_CONFIRMATION') {
      const result=await confirm({token,chatPublicId,casePublicId,versionNumber,section});
      if(section==='DATA') return {...result,versionNumber};
    } else if (section==='DATA') return {phase:'SOP_LOCKED',versionNumber};
    const data=await executeData({token,chatPublicId,casePublicId,versionNumber,
      specification:pending.proposal.contract.dataSpecification});
    return {phase:data.reviewStatus==='CONFIRMED'?'DATA_CONFIRMED':'DATA_REVIEW',versionNumber,data};
  };
}
