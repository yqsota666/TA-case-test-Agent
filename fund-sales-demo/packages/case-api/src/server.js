import mysql from 'mysql2/promise';
import { createCaseRepository } from '../../platform-store/src/index.js';
import { migrationConfig } from '../../platform-store/src/migrate.js';
import { createPersistedDiscussionService, createSophnetCompletion,
  createPlanConfirmationGraph, decidePlan, deriveDataSpecification,
  createDataGenerationGraph, deriveDataReview } from '../../case-agent/src/index.js';
import { createCaseHttpServer } from './http.js';
import { createConfirmPlanWithData } from './confirm-plan-data.js';

const allowedOrigin = process.env.CASE_PUBLIC_ORIGIN;
if (!allowedOrigin) throw new Error('CASE_PUBLIC_ORIGIN is required');
const pool = mysql.createPool({ ...migrationConfig(), connectionLimit: 8 });
const transaction = async action => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
};
const repository = createCaseRepository({ transaction });
const discussionService = createPersistedDiscussionService({ repository,
  complete: createSophnetCompletion() });
const complete = createSophnetCompletion();
const completeData = async input => {
  try { return await complete(input); }
  catch (error) {
    if (error.code !== 'MODEL_EMPTY_OUTPUT') throw error;
    return complete(input);
  }
};
const executeData = async ({ token, chatPublicId, casePublicId, versionNumber, specification }) => {
  const plan = await repository.getLatestSopProposal(token, chatPublicId, casePublicId);
  if (!plan || plan.status !== 'LOCKED' || plan.versionNumber !== versionNumber) {
    const error = new Error('须先确认对应版本的 Plan');
    error.code = 'PLAN_NOT_CONFIRMED'; error.status = 409; throw error;
  }
  const existing = await repository.generatedData(token, chatPublicId, casePublicId);
  if (existing.status === 'VALIDATED') return { ...existing, replayed: true };
  specification ??= await deriveDataSpecification(completeData, plan.proposal);
  return repository.executeGeneratedData(token, chatPublicId, casePublicId,
    versionNumber, specification, (db, scope, data) =>
      createDataGenerationGraph({ db, scope, specification: data }).invoke({}));
};
const confirmPlan = createConfirmPlanWithData({ repository,
  derive: plan => deriveDataSpecification(completeData, plan),
  confirm: ({ token, chatPublicId, casePublicId, versionNumber }) =>
    decidePlan(createPlanConfirmationGraph({ repository, token, chatPublicId, casePublicId }),
      { decision: 'CONFIRM', versionNumber }),
  executeData });
const reviseData = async ({ token, chatPublicId, casePublicId, revision, userInput }) => {
  const [plan, data, history] = await Promise.all([
    repository.getLatestSopProposal(token, chatPublicId, casePublicId),
    repository.generatedData(token, chatPublicId, casePublicId),
    repository.dataReviewTurns(token, chatPublicId, casePublicId),
  ]);
  if (data.reviewStatus !== 'PENDING_REVIEW') {
    const error = new Error('当前数据不能继续修改');
    error.code = 'DATA_NOT_REVIEWABLE'; error.status = 409; throw error;
  }
  if (data.revision !== revision) {
    const error = new Error('数据已更新，请刷新后重试');
    error.code = 'DATA_EDIT_CONFLICT'; error.status = 409; throw error;
  }
  const suggestion = await deriveDataReview(completeData,
    { plan: plan.proposal, data, turns: history.turns, userInput });
  const updated = await repository.editGeneratedData(token, chatPublicId, casePublicId,
    { revision, changes: suggestion.changes }, { userInput, reply: suggestion.reply });
  return { reply: suggestion.reply, data: updated };
};
const server = createCaseHttpServer({ repository, discussionService, confirmPlan,
  executeData, reviseData, allowedOrigin });
server.listen(Number(process.env.CASE_API_PORT ?? 3100), '127.0.0.1');
