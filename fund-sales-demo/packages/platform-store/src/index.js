import crypto from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

export function storeError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function requiredUuid(value, name) {
  if (typeof value !== 'string' || !uuid.test(value)) {
    throw storeError('INVALID_ID', 400, `${name} 无效`);
  }
  return value.toLowerCase();
}

function titleText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    throw storeError('INVALID_TITLE', 400, '标题须为 1–160 个字符');
  }
  return value.trim();
}

function validPlanText(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1000 &&
    value.trim() === value &&
    !/[\r\n]|\*\*|__|`|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(value);
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validSopPlan(plan) {
  return hasExactKeys(plan, ['objective', 'preconditions', 'scenarios', 'openQuestions']) &&
    validPlanText(plan.objective) &&
    Array.isArray(plan.preconditions) && plan.preconditions.length <= 50 &&
    plan.preconditions.every(validPlanText) &&
    Array.isArray(plan.scenarios) && plan.scenarios.length >= 1 && plan.scenarios.length <= 100 &&
    plan.scenarios.every(scenario =>
      hasExactKeys(scenario, ['title', 'setup', 'action', 'expected', 'evidence']) &&
      ['title', 'setup', 'action', 'expected', 'evidence'].every(key => validPlanText(scenario[key]))) &&
    Array.isArray(plan.openQuestions) && plan.openQuestions.length <= 50 &&
    plan.openQuestions.every(validPlanText);
}

export function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function authenticateSession(db, token) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) {
    throw storeError('UNAUTHENTICATED', 401, '请先登录');
  }
  const [[user]] = await db.execute(`SELECT u.id AS user_id, w.id AS workspace_id
    FROM platform_sessions s
    JOIN platform_users u ON u.id=s.user_id AND u.status='ACTIVE'
    JOIN workspaces w ON w.owner_user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)`, [sessionTokenHash(token)]);
  if (!user) throw storeError('UNAUTHENTICATED', 401, '登录状态已失效');
  return Object.freeze(user);
}

// The caller supplies a transaction over one connection. No method accepts a
// client-supplied workspace ID or exposes that connection to an HTTP handler.
export function createCaseRepository({ transaction }) {
  if (typeof transaction !== 'function') throw new TypeError('transaction is required');

  async function createChat(token, title) {
    const cleanTitle = titleText(title);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const publicId = crypto.randomUUID();
      const [result] = await db.execute(`INSERT INTO case_chats(public_id,workspace_id,title)
        VALUES (?,?,?)`, [publicId, auth.workspace_id, cleanTitle]);
      await db.execute(`INSERT INTO chat_state_events
        (workspace_id,chat_id,to_status,actor_user_id) VALUES (?,?,'ACTIVE',?)`,
      [auth.workspace_id, result.insertId, auth.user_id]);
      return { publicId };
    });
  }

  async function createCase(token, chatPublicId, title) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    const cleanTitle = titleText(title);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const publicId = crypto.randomUUID();
      const [result] = await db.execute(`INSERT INTO cases
        (public_id,workspace_id,chat_id,title) VALUES (?,?,?,?)`,
      [publicId, auth.workspace_id, chat.id, cleanTitle]);
      await db.execute(`INSERT INTO case_state_events
        (workspace_id,chat_id,case_id,to_status,actor_user_id)
        VALUES (?,?,?,'DISCUSSING',?)`,
      [auth.workspace_id, chat.id, result.insertId, auth.user_id]);
      return { publicId };
    });
  }

  async function listCases(token, chatPublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status,title FROM case_chats
        WHERE workspace_id=? AND public_id=?`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      const [cases] = await db.execute(`SELECT public_id,title,status,created_at
        FROM cases WHERE workspace_id=? AND chat_id=? ORDER BY id`,
      [auth.workspace_id, chat.id]);
      return { chat: { title: chat.title, status: chat.status }, cases };
    });
  }

  async function saveSopProposal(token, chatPublicId, casePublicId, proposal) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!validSopPlan(proposal)) {
      throw storeError('INVALID_PLAN', 400, 'Plan 提案无效');
    }
    const planJson = JSON.stringify(proposal);
    if (!planJson || planJson.length > 100000) {
      throw storeError('INVALID_PLAN', 400, 'Plan 提案无效或过长');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (!['DISCUSSING', 'SOP_PENDING'].includes(caseRow.status)) {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能提交 Plan 提案');
      }
      const [[latest]] = await db.execute(`SELECT id,version_number,status FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (latest?.status === 'LOCKED') throw storeError('SOP_LOCKED', 409, 'SOP 已锁定');
      if (latest?.status === 'PENDING_CONFIRMATION') {
        await db.execute(`UPDATE case_sop_versions SET status='DRAFT'
          WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id, latest.id]);
      }
      const versionNumber = (latest?.version_number ?? 0) + 1;
      await db.execute(`INSERT INTO case_sop_versions
        (workspace_id,chat_id,case_id,version_number,plan_json,status)
        VALUES (?,?,?,?,?,'PENDING_CONFIRMATION')`,
      [auth.workspace_id, chat.id, caseRow.id, versionNumber, planJson]);
      if (caseRow.status === 'DISCUSSING') {
        await db.execute(`UPDATE cases SET status='SOP_PENDING'
          WHERE workspace_id=? AND chat_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id]);
        await db.execute(`INSERT INTO case_state_events
          (workspace_id,chat_id,case_id,from_status,to_status,reason)
          VALUES (?,?,?,'DISCUSSING','SOP_PENDING','AI_PLAN_PROPOSAL')`,
        [auth.workspace_id, chat.id, caseRow.id]);
      }
      return { versionNumber, status: 'PENDING_CONFIRMATION' };
    });
  }

  async function getLatestSopProposal(token, chatPublicId, casePublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id FROM case_chats
        WHERE workspace_id=? AND public_id=?`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      const [[caseRow]] = await db.execute(`SELECT id FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=?`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const [[latest]] = await db.execute(`SELECT version_number,plan_json,status,locked_at
        FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (!latest) return null;
      return { versionNumber: latest.version_number, status: latest.status,
        proposal: typeof latest.plan_json === 'string' ? JSON.parse(latest.plan_json) : latest.plan_json,
        lockedAt: latest.locked_at };
    });
  }

  async function confirmSopProposal(token, chatPublicId, casePublicId, versionNumber) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
      throw storeError('INVALID_VERSION', 400, 'Plan 版本号无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (caseRow.status !== 'SOP_PENDING') {
        throw storeError('INVALID_CASE_STATE', 409, 'Case 尚无待确认的 Plan');
      }
      const [[latest]] = await db.execute(`SELECT id,version_number,plan_json,status
        FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (!latest || latest.version_number !== versionNumber || latest.status !== 'PENDING_CONFIRMATION') {
        throw storeError('STALE_PLAN', 409, 'Plan 已更新，请重新审阅最新版本');
      }
      const plan = typeof latest.plan_json === 'string' ? JSON.parse(latest.plan_json) : latest.plan_json;
      if (!validSopPlan(plan)) {
        throw storeError('INVALID_PLAN', 409, '已保存的 Plan 结构无效，请重新生成');
      }
      if (plan.openQuestions.length) {
        throw storeError('PLAN_HAS_OPEN_QUESTIONS', 409, '请先解决 Plan 中的待确认事项');
      }
      await db.execute(`UPDATE case_sop_versions SET status='LOCKED',locked_at=UTC_TIMESTAMP(3)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
      [auth.workspace_id, chat.id, caseRow.id, latest.id]);
      await db.execute(`UPDATE cases SET status='SOP_LOCKED'
        WHERE workspace_id=? AND chat_id=? AND id=?`,
      [auth.workspace_id, chat.id, caseRow.id]);
      await db.execute(`INSERT INTO case_state_events
        (workspace_id,chat_id,case_id,from_status,to_status,actor_user_id,reason)
        VALUES (?,?,?,'SOP_PENDING','SOP_LOCKED',?,'USER_CONFIRMED_PLAN')`,
      [auth.workspace_id, chat.id, caseRow.id, auth.user_id]);
      return { versionNumber, status: 'LOCKED' };
    });
  }

  return Object.freeze({ createChat, createCase, listCases, saveSopProposal,
    getLatestSopProposal, confirmSopProposal });
}
