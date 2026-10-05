import { sessionTokenHash } from '../auth.js';

export function scopeError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

export async function authenticateSession(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw scopeError('请先登录', 401, 'UNAUTHENTICATED');
  }
  const [[row]] = await db.execute(`SELECT u.id AS user_id,w.id AS workspace_id
    FROM platform_sessions s JOIN platform_users u ON u.id=s.user_id
    JOIN workspaces w ON w.owner_user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='ACTIVE'`, [sessionTokenHash(token)]);
  if (!row) throw scopeError('登录状态已失效', 401, 'UNAUTHENTICATED');
  return Object.freeze(row);
}

export async function resolveRun(db, auth, { chatPublicId, runPublicId }) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (!uuid.test(chatPublicId || '') || !uuid.test(runPublicId || '')) {
    throw scopeError('chat 或执行编号无效', 400, 'INVALID_SCOPE');
  }
  const [[row]] = await db.execute(`SELECT r.id AS run_id,r.chat_id,r.workspace_id,
    r.channel_id,r.ta_environment_id,r.ta_code,r.distributor_code,r.business_date,r.status,
    c.status AS chat_status
    FROM test_runs r JOIN test_chats c ON c.workspace_id=r.workspace_id AND c.id=r.chat_id
    WHERE r.workspace_id=? AND c.public_id=? AND r.public_id=?`,
  [auth.workspace_id, chatPublicId, runPublicId]);
  if (!row) throw scopeError('chat 或执行不存在', 404, 'SCOPE_NOT_FOUND');
  return Object.freeze(row);
}

// The workspace row is the mutex for starting, writing, and ending global Chats.
export async function assertWritableChat(db, auth, parentChatId) {
  await db.execute('SELECT id FROM workspaces WHERE id=? FOR UPDATE', [auth.workspace_id]);
  const [[chat]]=await db.execute(`SELECT ended_at FROM global_case_ledgers
    WHERE workspace_id=? AND chat_id=?`,[auth.workspace_id,parentChatId]);
  if (!chat) throw scopeError('Chat 不存在',404,'CHAT_NOT_FOUND');
  if (chat.ended_at) throw scopeError('Chat 已人工结束，只能查看历史',409,'CHAT_ENDED');
  const [[first]]=await db.execute(`SELECT chat_id FROM global_case_ledgers
    WHERE workspace_id=? AND ended_at IS NULL ORDER BY chat_id LIMIT 1`,[auth.workspace_id]);
  if (String(first?.chat_id)!==String(parentChatId))
    throw scopeError('请先处理更早创建的 Chat',409,'CHAT_QUEUED');
}

export async function assertWritableRun(db, auth, scope) {
  const [[parent]]=await db.execute(`SELECT COALESCE(l.chat_id,p.chat_id) AS parent_chat_id
    FROM test_runs r
    LEFT JOIN global_case_ledgers l ON l.workspace_id=r.workspace_id AND l.chat_id=r.chat_id
    LEFT JOIN global_cases g ON g.workspace_id=r.workspace_id AND g.chat_id=r.chat_id AND g.run_id=r.id
    LEFT JOIN global_case_ledgers p ON p.workspace_id=g.workspace_id AND p.chat_id=g.parent_chat_id
    WHERE r.workspace_id=? AND r.chat_id=? AND r.id=?`,
  [auth.workspace_id,scope.chat_id,scope.run_id]);
  if (parent?.parent_chat_id!=null) await assertWritableChat(db,auth,parent.parent_chat_id);
  else {
    await db.execute('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[auth.workspace_id]);
    const [[open]]=await db.execute(`SELECT chat_id FROM global_case_ledgers
      WHERE workspace_id=? AND ended_at IS NULL ORDER BY chat_id LIMIT 1`,[auth.workspace_id]);
    if(open)throw scopeError('当前工作空间正在推进全局 Chat','CHAT_SCOPE_REQUIRED',409);
  }
}

export function mapDatabaseError(error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return scopeError('测试标识或记录已占用，不能在其他 chat 中复用', 409, 'IDENTIFIER_CONFLICT');
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return scopeError('关联记录不属于当前 chat 和执行', 409, 'CROSS_SCOPE_REFERENCE');
  }
  return error;
}
