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
  return value;
}

function titleText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    throw storeError('INVALID_TITLE', 400, '标题须为 1–160 个字符');
  }
  return value.trim();
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
    requiredUuid(chatPublicId, 'Chat');
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
    requiredUuid(chatPublicId, 'Chat');
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

  return Object.freeze({ createChat, createCase, listCases });
}
