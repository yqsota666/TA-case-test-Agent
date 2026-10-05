import { authenticateSession, storeError } from './index.js';

export function boundPreparationHistory(state) {
  const all = state.turns ?? [];
  let turns = all.slice(-20);
  let turnsOmitted = (state.turnsOmitted ?? 0) + all.length - turns.length;
  const size = value => Buffer.byteLength(JSON.stringify(value));
  while (turns.length > 1 && (size(turns) > 64000 ||
    size({ ...state, turns, turnsOmitted }) > 240000)) {
    turns = turns.slice(1);
    turnsOmitted += 1;
  }
  const bounded = { ...state, turns, turnsOmitted };
  if (size(turns) > 64000 || size(bounded) > 240000) {
    throw storeError('INVALID_INPUT', 400, '申请准备内容过大，无法保存');
  }
  return bounded;
}

export function createApplicationPreparationRepository({ transaction }) {
  const json = value => typeof value === 'string' ? JSON.parse(value) : value;
  async function scope(db, token, chatPublicId, casePublicId, writable) {
    if (![chatPublicId, casePublicId].every(value => typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) {
      throw storeError('INVALID_ID', 400, 'Chat 或 Case 标识无效');
    }
    const auth = await authenticateSession(db, token);
    const [[row]] = await db.execute(`SELECT k.id AS case_id,k.chat_id,c.status AS chat_status,
      k.status AS case_status,d.revision AS confirmed_revision
      FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
      LEFT JOIN case_data_confirmations d ON d.workspace_id=k.workspace_id
        AND d.chat_id=k.chat_id AND d.case_id=k.id
      WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=? ${writable ? 'FOR UPDATE' : ''}`,
    [auth.workspace_id, chatPublicId, casePublicId]);
    if (!row) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
    if (writable && (row.chat_status !== 'ACTIVE' || !['SOP_LOCKED','EXECUTING'].includes(row.case_status) ||
      row.confirmed_revision === null)) throw storeError('DATA_NOT_CONFIRMED', 409, '须先确认当前 Case 的数据');
    return [auth.workspace_id, row.chat_id, row.case_id];
  }
  async function read(token, { chatPublicId, casePublicId }) {
    return transaction(async db => {
      const keys = await scope(db, token, chatPublicId, casePublicId, false);
      const [[row]] = await db.execute(`SELECT revision,state_json FROM case_application_preparations
        WHERE workspace_id=? AND chat_id=? AND case_id=?`, keys);
      return row ? { ...json(row.state_json), revision: Number(row.revision) } :
        { phase: 'NOT_STARTED', revision: 0, intents: [], turns: [], stagedKeys: [], files: [] };
    });
  }
  async function save(token, { chatPublicId, casePublicId, revision, state }) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw storeError('INVALID_INPUT', 400, '申请准备版本或内容无效');
    }
    const bounded = boundPreparationHistory(state);
    return transaction(async db => {
      const keys = await scope(db, token, chatPublicId, casePublicId, true);
      const [[row]] = await db.execute(`SELECT revision FROM case_application_preparations
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (Number(row?.revision ?? 0) !== revision) {
        throw storeError('APPLICATION_PREPARATION_CONFLICT', 409, '申请内容已更新，请刷新后重试');
      }
      if (row) await db.execute(`UPDATE case_application_preparations SET revision=?,state_json=?
        WHERE workspace_id=? AND chat_id=? AND case_id=?`,
      [revision + 1, JSON.stringify(bounded), ...keys]);
      else await db.execute(`INSERT INTO case_application_preparations
        (workspace_id,chat_id,case_id,revision,state_json) VALUES (?,?,?,?,?)`,
      [...keys, revision + 1, JSON.stringify(bounded)]);
      return { ...bounded, revision: revision + 1 };
    });
  }
  return Object.freeze({ read, save });
}
