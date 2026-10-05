export function createConfirmPlanWithData({ repository, derive, confirm, executeData }) {
  return async ({ token, chatPublicId, casePublicId, versionNumber }) => {
    const pending = await repository.getLatestSopProposal(token, chatPublicId, casePublicId);
    if (!pending || !['PENDING_CONFIRMATION', 'LOCKED'].includes(pending.status) ||
        pending.versionNumber !== versionNumber) {
      const error = new Error('请先审阅最新的 Plan');
      error.code = 'STALE_PLAN'; error.status = 409; throw error;
    }
    let specification;
    if (pending.status === 'PENDING_CONFIRMATION') {
      specification = await derive(pending.proposal);
      await confirm({ token, chatPublicId, casePublicId, versionNumber });
    }
    const data = await executeData({ token, chatPublicId, casePublicId, versionNumber, specification });
    return { phase: data.reviewStatus === 'CONFIRMED' ? 'DATA_CONFIRMED' : 'DATA_REVIEW',
      versionNumber, data };
  };
}
