export function createConfirmPlanWithData({ repository, derive, confirm, executeData }) {
  return async ({ token, chatPublicId, casePublicId, versionNumber }) => {
    const pending = await repository.getLatestSopProposal(token, chatPublicId, casePublicId);
    if (!pending || pending.status !== 'PENDING_CONFIRMATION' || pending.versionNumber !== versionNumber) {
      const error = new Error('请先审阅最新的 Plan');
      error.code = 'STALE_PLAN'; error.status = 409; throw error;
    }
    const specification = await derive(pending.proposal);
    await confirm({ token, chatPublicId, casePublicId, versionNumber });
    const data = await executeData({ token, chatPublicId, casePublicId, versionNumber, specification });
    return { phase: 'DATA_REVIEW', versionNumber, data };
  };
}
