import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { createCaseRepository, sessionTokenHash } from '../packages/platform-store/src/index.js';
import { migrationConfig } from '../packages/platform-store/src/migrate.js';

const token = process.env.CASE_TEST_SESSION;
if (!token) throw new Error('CASE_TEST_SESSION is required');
const pool = mysql.createPool({ ...migrationConfig(), connectionLimit: 2 });
const transaction = async action => {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await action(db);
    await db.commit();
    return result;
  } catch (error) {
    try { await db.rollback(); }
    catch (rollbackError) {
      console.error('数据库回滚失败', rollbackError.code ?? 'UNKNOWN');
    }
    throw error;
  }
  finally { db.release(); }
};
try {
  const userId = crypto.randomUUID();
  await transaction(async db => {
    const [user] = await db.execute(`INSERT INTO platform_users
      (public_id,email,password_hash,display_name) VALUES (?,?,?,'本地验收')`,
    [userId, `local-data-${userId}@example.test`, 'local-test-only']);
    await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',
      [crypto.randomUUID(), user.insertId]);
    await db.execute(`INSERT INTO platform_sessions(token_hash,user_id,expires_at)
      VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`,
    [sessionTokenHash(token), user.insertId]);
  });
  const repository = createCaseRepository({ transaction });
  const chat = await repository.createChat(token, '数据生成节点本地验收');
  const caseRow = await repository.createCase(token, chat.publicId, '确认 Plan 后生成模拟数据');
  const proposal = {
    objective: '只生成并核对一名模拟客户、归属该客户的交易账户和一只模拟基金，不创建申请、文件或 TA 回传',
    preconditions: ['客户名本地验收客户甲，个人类型1，模拟余额100000.00元',
      '交易账户归属该客户，分支代码305，交易账号由系统生成',
      '基金代码990901，名称本地验收浮动费基金，A类份额，净值1.00000000'],
    scenarios: [{ title: '数据关联核对', setup: '使用上述模拟数据',
      action: '创建客户、账户和基金并校验客户与账户归属',
      expected: '客户与账户关联正确，基金字段一致',
      evidence: '客户ID、账户ID与交易账号、基金代码及字段' }],
    openQuestions: [],
  };
  const plan = await repository.saveSopProposal(token, chat.publicId, caseRow.publicId, proposal);
  if (process.env.CASE_SEED_PENDING_PLAN !== '1') {
    await repository.confirmSopProposal(token, chat.publicId, caseRow.publicId, plan.versionNumber);
  }
  process.stdout.write(JSON.stringify({ chatId: chat.publicId,
    caseId: caseRow.publicId, versionNumber: plan.versionNumber }) + '\n');
} finally { await pool.end(); }
