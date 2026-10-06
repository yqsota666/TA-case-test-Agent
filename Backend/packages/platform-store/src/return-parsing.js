import { authenticateSession, storeError } from './index.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = value => typeof value === 'string' ? JSON.parse(value) : value;

export function createReturnParsingRepository({ transaction }) {
  function validate(scope) {
    if (!uuid.test(scope.chatPublicId ?? '') || !uuid.test(scope.casePublicId ?? '')) {
      throw storeError('INVALID_INPUT', 400, 'Chat 或 Case 标识无效');
    }
  }
  async function context(db, token, scope, write = false) {
    validate(scope);
    const auth = await authenticateSession(db, token);
    const [[owner]] = await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,
      c.status AS chat_status,k.status AS case_status
      FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
      WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=?${write ? ' FOR UPDATE' : ''}`,
    [auth.workspace_id, scope.chatPublicId, scope.casePublicId]);
    if (!owner) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
    if (write && (owner.chat_status !== 'ACTIVE' || ['PASS', 'FAIL'].includes(owner.case_status))) {
      throw storeError('CASE_NOT_WRITABLE', 409, 'Chat 或 Case 已结束，不能上传');
    }
    const keys = [auth.workspace_id, owner.chat_id, owner.case_id];
    const [rows] = await db.execute(`SELECT DISTINCT b.id AS batch_id,b.public_id AS batch_public_id,
      f.file_type,f.file_name,h.ta_code,h.distributor_code,h.protocol_version
      FROM applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id
        AND ba.chat_id=a.chat_id AND ba.application_id=a.id
      JOIN exchange_batches b ON b.workspace_id=ba.workspace_id AND b.chat_id=ba.chat_id AND b.id=ba.batch_id
      JOIN exchange_files f ON f.workspace_id=b.workspace_id AND f.chat_id=b.chat_id
        AND f.batch_id=b.id AND f.direction='OUTBOUND' AND f.file_type=a.file_type
      JOIN exchange_channels h ON h.workspace_id=b.workspace_id AND h.id=b.channel_id
      WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? ORDER BY b.id,f.file_type,f.file_name`, keys);
    const targets = [];
    for (const row of rows) {
      const expectedType = row.file_type === '01' ? '02' : '04';
      let target = targets.find(item => item.batchPublicId === row.batch_public_id && item.expectedType === expectedType);
      if (!target) {
        target = { batchId: String(row.batch_id), batchPublicId: row.batch_public_id, expectedType,
          outboundType: row.file_type, outboundFiles: [], channel: { taCode: row.ta_code,
            distributorCode: row.distributor_code, protocolVersion: row.protocol_version } };
        targets.push(target);
      }
      target.outboundFiles.push(row.file_name);
    }
    return { auth, keys, targets };
  }

  async function read(token, scope) {
    return transaction(async db => {
      const { keys, targets } = await context(db, token, scope);
      const [parses] = await db.execute(`SELECT id,batch_id,expected_type,parsed_json
        FROM case_return_parses WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
      return { steps: targets.map(target => ({ ...target, parses: parses.filter(row =>
        String(row.batch_id) === target.batchId && row.expected_type === target.expectedType)
        .map(row => ({ parseId: String(row.id), result: json(row.parsed_json) })) })) };
    });
  }

  async function parse(token, input, runGraph) {
    if (!uuid.test(input.batchPublicId ?? '') || !['02', '04'].includes(input.expectedType)) {
      throw storeError('INVALID_INPUT', 400, '批次或回传类型无效');
    }
    return transaction(async db => {
      const { auth, keys, targets } = await context(db, token, input, true);
      const target = targets.find(item => item.batchPublicId === input.batchPublicId && item.expectedType === input.expectedType);
      if (!target) throw storeError('RETURN_NOT_EXPECTED', 409, '当前 Case 尚未生成对应的 01 或 03 文件');
      const state = await runGraph(target);
      const { rawFiles, result } = state.parsed;
      const [[prior]] = await db.execute(`SELECT id,parsed_json FROM case_return_parses
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND batch_id=? AND expected_type=? AND content_sha256=?`,
      [...keys, target.batchId, input.expectedType, result.sha256]);
      if (prior) return { phase: 'PARSED', parseId: String(prior.id), duplicate: true, result: json(prior.parsed_json) };
      const [saved] = await db.execute(`INSERT INTO case_return_parses
        (workspace_id,chat_id,case_id,batch_id,expected_type,content_sha256,parsed_json,actor_user_id)
        VALUES (?,?,?,?,?,?,?,?)`, [...keys, target.batchId, input.expectedType,
        result.sha256, JSON.stringify(result), auth.user_id]);
      for (const file of rawFiles) {
        await db.execute(`INSERT INTO case_return_parse_files
          (workspace_id,chat_id,case_id,parse_id,file_name,content_sha256,raw_bytes) VALUES (?,?,?,?,?,?,?)`,
        [...keys, saved.insertId, file.fileName, file.sha256, file.rawBytes]);
      }
      return { phase: state.phase, parseId: String(saved.insertId), duplicate: false, result };
    });
  }
  return Object.freeze({ read, parse });
}
