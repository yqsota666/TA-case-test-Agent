import {createTaResetRepository} from '../../platform-store/src/ta-reset.js';
import {createChatLifecycleRepository} from '../../platform-store/src/chat-lifecycle.js';
import { createDurableWorkflowRepository } from '../../platform-store/src/durable-workflow.js';
import mysql from 'mysql2/promise';
import { createCaseRepository } from '../../platform-store/src/index.js';
import { createExchangeRepository } from '../../platform-store/src/exchange.js';
import { createApplicationPreparationRepository } from '../../platform-store/src/application-preparation.js';
import { migrationConfig } from '../../platform-store/src/migrate.js';
import { createPersistedDiscussionService, createSophnetCompletion,
  createPlanConfirmationGraph, decidePlan, deriveDataSpecification,
  createDataGenerationGraph, deriveDataReview, deriveApplicationPreparation } from '../../case-agent/src/index.js';
import { createCaseHttpServer } from './http.js';
import { createConfirmPlanWithData } from './confirm-plan-data.js';
import { createApplicationPreparationService } from './prepare-applications.js';
import { createReturnParsingRepository } from '../../platform-store/src/return-parsing.js';
import { createReturnParsingService } from './return-parsing.js';

import { createReturnConfirmationRepository } from '../../platform-store/src/return-confirmation.js';
import { createExchangePlanSupplementRepository } from '../../platform-store/src/exchange-plan-supplement.js';
import { createReturnConfirmationService } from './return-confirmation.js';

import { createTaReceiptsRepository } from '../../platform-store/src/ta-receipts.js';
import { createHoldingsReturnRepository } from '../../platform-store/src/holdings-return.js';

import { createCaseResultRepository } from '../../platform-store/src/case-result.js';
import { createCaseResultService } from './case-result.js';

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
    try { await connection.rollback(); }
    catch (rollbackError) {
      console.error('数据库回滚失败', rollbackError.code ?? 'UNKNOWN');
    }
    throw error;
  } finally { connection.release(); }
};
const taReset=createTaResetRepository({transaction});
const chatLifecycle=createChatLifecycleRepository({transaction});
const durableWorkflow = createDurableWorkflowRepository({pool});
const repository = createCaseRepository({ transaction });
const returnParsing = createReturnParsingService({ repository: createReturnParsingRepository({ transaction }) });
const exchangePlanSupplement=createExchangePlanSupplementRepository({transaction});
const returnConfirmation = createReturnConfirmationService({ repository: createReturnConfirmationRepository({ transaction }) });
const taReceipts = createTaReceiptsRepository({transaction});
const holdingsReturn = createHoldingsReturnRepository({transaction});
const exchangeRepository = createExchangeRepository({ transaction });
const preparations = createApplicationPreparationRepository({ transaction });
const discussionService = createPersistedDiscussionService({ repository,
  complete: createSophnetCompletion() });
const complete = createSophnetCompletion();
const caseResult = createCaseResultService({repository:createCaseResultRepository({transaction}),complete});
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
  specification ??= plan.proposal.contract?.dataSpecification ?? await deriveDataSpecification(completeData, plan.proposal);
  return repository.executeGeneratedData(token, chatPublicId, casePublicId,
    versionNumber, specification, (db, scope, data) =>
      createDataGenerationGraph({ db, scope, specification: data }).invoke({}));
};
const confirmPlan = createConfirmPlanWithData({ repository,
  confirm: ({ token, chatPublicId, casePublicId, versionNumber, section }) =>
    decidePlan(createPlanConfirmationGraph({ repository, token, chatPublicId, casePublicId }),
      { decision: 'CONFIRM', versionNumber, section }),
  executeData });
const reviseData = async ({ token, chatPublicId, casePublicId, revision, userInput }) => {
  const [plan, data, history] = await Promise.all([
    repository.getLatestSopProposal(token, chatPublicId, casePublicId),
    repository.generatedData(token, chatPublicId, casePublicId),
    repository.dataReviewTurns(token, chatPublicId, casePublicId),
  ]);
  if(plan?.proposal?.contract) throw Object.assign(new Error('Plan数据已锁定；业务修改请新建Case重新确认'),{code:'PLAN_DATA_FROZEN',status:409});
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
const applicationPreparation = createApplicationPreparationService({ repository, preparations,
  exchangeRepository, confirmedSales: returnConfirmation, derive: context => deriveApplicationPreparation(completeData, context) });
const confirmData = ({ token, chatPublicId, casePublicId, revision }) =>
  repository.confirmGeneratedData(token, chatPublicId, casePublicId, revision);
const server = createCaseHttpServer({ repository, discussionService, confirmPlan,
  executeData, reviseData, exchangeRepository, applicationPreparation, confirmData, returnParsing, returnConfirmation, holdingsReturn, taReceipts, caseResult, exchangePlanSupplement, chatLifecycle, durableWorkflow, taReset, allowedOrigin });
server.listen(Number(process.env.CASE_API_PORT ?? 3100), '127.0.0.1');
