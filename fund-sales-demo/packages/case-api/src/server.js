import mysql from 'mysql2/promise';
import { createCaseRepository } from '../../platform-store/src/index.js';
import { migrationConfig } from '../../platform-store/src/migrate.js';
import { createPersistedDiscussionService, createSophnetCompletion,
  createPlanConfirmationGraph, decidePlan } from '../../case-agent/src/index.js';
import { createCaseHttpServer } from './http.js';

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
const confirmPlan = ({ token, chatPublicId, casePublicId, versionNumber }) =>
  decidePlan(createPlanConfirmationGraph({ repository, token, chatPublicId, casePublicId }),
    { decision: 'CONFIRM', versionNumber });
const server = createCaseHttpServer({ repository, discussionService, confirmPlan, allowedOrigin });
server.listen(Number(process.env.CASE_API_PORT ?? 3100), '127.0.0.1');
