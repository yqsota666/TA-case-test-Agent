import crypto from 'node:crypto';
import { confirmationCodeFor, encodeRecord, FIELD_REQUIREMENTS, parseDataFile } from '../../platform-protocol/src/index.js';
import { authenticateSession, storeError } from './index.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fileNamePattern = /^[A-Za-z0-9_.-]{1,120}$/;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function validUuid(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw storeError('INVALID_ID', 400, '标识无效');
  return value;
}

function validId(value) {
  if (!/^[1-9]\d{0,18}$/.test(String(value))) throw storeError('INVALID_ID', 400, '标识无效');
  return String(value);
}

function validDate(value) {
  if (!/^\d{8}$/.test(value) || !Number.isFinite(Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`))
    || new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`).toISOString().slice(0, 10).replaceAll('-', '') !== value) {
    throw storeError('INVALID_DATE', 400, '业务日期无效');
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
}

function validSnapshot(fileType, record, version, channel, businessDate) {
  if (!['01', '03'].includes(fileType) || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw storeError('INVALID_APPLICATION', 400, '申请格式无效');
  }
  if (!/^[0-9A-Za-z]{1,24}$/.test(record.AppSheetSerialNo || '')
    || !/^\d{3}$/.test(record.BusinessCode || '')
    || String(record.DistributorCode || '') !== String(channel.distributor_code)) {
    throw storeError('INVALID_APPLICATION', 400, '申请号、业务代码或销售机构不一致');
  }
  const requirements = FIELD_REQUIREMENTS[fileType];
  const byBusiness = requirements.requiredByBusiness[record.BusinessCode];
  if (fileType === '01' ? !/^00[1-9]$/.test(record.BusinessCode) : !byBusiness) {
    throw storeError('INVALID_APPLICATION', 400, '不支持的申请业务代码');
  }
  const missing = [...requirements.required, ...(byBusiness || [])].filter(name =>
    record[name] === null || record[name] === undefined || String(record[name]).trim() === '');
  if (missing.length) throw storeError('MISSING_APPLICATION_FIELD', 400, `申请缺少必填字段：${missing.join(', ')}`);
  if (record.TransactionDate !== businessDate) {
    throw storeError('APPLICATION_DATE_MISMATCH', 400, '申请交易日期与业务日不一致');
  }
  const snapshot = JSON.stringify(record);
  if (Buffer.byteLength(snapshot) > 65536) throw storeError('INVALID_APPLICATION', 400, '申请快照过大');
  const encoded = encodeRecord(fileType, record, version);
  return { snapshot, hash: crypto.createHash('sha256').update(encoded).digest('hex') };
}

export function createExchangeRepository({ transaction }) {
  if (typeof transaction !== 'function') throw new TypeError('transaction is required');

  async function stageApplication(token, { chatPublicId, casePublicId, sopVersionId, channelId, businessDate, fileType, record }) {
    validUuid(chatPublicId); validUuid(casePublicId);
    validId(sopVersionId); validId(channelId);
    const date = validDate(businessDate);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[scope]] = await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,s.id AS sop_id,
        h.id AS channel_id,h.distributor_code,h.protocol_version
        FROM case_chats c
        JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
        JOIN case_sop_versions s ON s.workspace_id=k.workspace_id AND s.chat_id=k.chat_id
          AND s.case_id=k.id AND s.status='LOCKED'
        JOIN exchange_channels h ON h.workspace_id=c.workspace_id
        WHERE c.workspace_id=? AND c.public_id=? AND c.status='ACTIVE'
          AND k.public_id=? AND k.status IN ('SOP_LOCKED','EXECUTING')
          AND s.id=? AND h.id=?`,
      [auth.workspace_id, chatPublicId, casePublicId, sopVersionId, channelId]);
      if (!scope) throw storeError('APPLICATION_SCOPE', 409, 'Case、SOP 或通道不可用于申请');
      const { snapshot, hash } = validSnapshot(fileType, record, scope.protocol_version, scope, businessDate);
      const publicId = crypto.randomUUID();
      await db.execute(`INSERT INTO applications
        (public_id,workspace_id,chat_id,case_id,sop_version_id,channel_id,business_date,
         file_type,business_code,app_no,record_json,snapshot_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [publicId, auth.workspace_id, scope.chat_id, scope.case_id, scope.sop_id, scope.channel_id,
        date, fileType, record.BusinessCode, record.AppSheetSerialNo, snapshot, hash]);
      return { publicId, snapshotHash: hash };
    });
  }

  async function saveInboundFile(token, { channelId, fileName, rawBytes }) {
    validId(channelId);
    if (typeof fileName !== 'string' || !fileNamePattern.test(fileName)
      || !Buffer.isBuffer(rawBytes) || !rawBytes.length || rawBytes.length > MAX_FILE_BYTES) {
      throw storeError('INVALID_FILE', 400, '文件名或大小无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[channel]] = await db.execute(`SELECT id,ta_code,distributor_code,protocol_version
        FROM exchange_channels WHERE workspace_id=? AND id=? FOR UPDATE`, [auth.workspace_id, channelId]);
      if (!channel) throw storeError('CHANNEL_NOT_FOUND', 404, '通道不存在');
      let parsed;
      try { parsed = parseDataFile(rawBytes); }
      catch (error) { throw storeError('INVALID_FILE', 400, `TA 文件结构无效：${error.message}`); }
      if (!['02', '04', '05'].includes(parsed.fileType)) throw storeError('INVALID_FILE', 400, '不是 TA 回传文件');
      const date = validDate(parsed.date);
      const prefix = `OFD_${channel.ta_code}_${channel.distributor_code}_${parsed.date}_${parsed.fileType}`;
      const suffix = fileName.slice(prefix.length);
      if (parsed.version !== channel.protocol_version || parsed.creator !== channel.ta_code
        || parsed.receiver !== channel.distributor_code || !fileName.startsWith(prefix)
        || !/^(?:_\d{3})?\.TXT$/.test(suffix)) {
        throw storeError('FILE_CHANNEL_MISMATCH', 409, '文件头、文件名或协议版本与通道不一致');
      }
      const digest = crypto.createHash('sha256').update(rawBytes).digest('hex');
      const [[existing]] = await db.execute(`SELECT id,content_sha256 FROM exchange_files
        WHERE workspace_id=? AND channel_id=? AND file_name=? FOR UPDATE`, [auth.workspace_id, channelId, fileName]);
      if (existing) {
        if (existing.content_sha256 !== digest) throw storeError('FILE_NAME_CONFLICT', 409, '同名文件内容不同');
        return { fileId: String(existing.id), duplicate: true };
      }
      const [[sameBytes]] = await db.execute(`SELECT id FROM exchange_files
        WHERE workspace_id=? AND channel_id=? AND direction='INBOUND' AND content_sha256=? FOR UPDATE`,
      [auth.workspace_id, channelId, digest]);
      if (sameBytes) return { fileId: String(sameBytes.id), duplicate: true };
      const [file] = await db.execute(`INSERT INTO exchange_files
        (workspace_id,channel_id,direction,file_type,file_name,content_sha256,raw_bytes,record_count)
        VALUES (?,?,'INBOUND',?,?,?,?,?)`,
      [auth.workspace_id, channelId, parsed.fileType, fileName, digest, rawBytes, parsed.records.length]);
      for (const [index, record] of parsed.records.entries()) {
        await db.execute(`INSERT INTO return_records
          (workspace_id,channel_id,file_id,file_type,record_index,record_json)
          VALUES (?,?,?,?,?,?)`,
        [auth.workspace_id, channelId, file.insertId, parsed.fileType, index + 1, JSON.stringify(record)]);
      }
      return { fileId: String(file.insertId), duplicate: false, businessDate: date, recordCount: parsed.records.length };
    });
  }

  async function createOutboundBatch(token, { chatPublicId, channelId, businessDate, applicationPublicIds }) {
    validUuid(chatPublicId); validId(channelId);
    const date = validDate(businessDate);
    if (!Array.isArray(applicationPublicIds) || applicationPublicIds.length < 1
      || applicationPublicIds.length > 1000 || new Set(applicationPublicIds).size !== applicationPublicIds.length) {
      throw storeError('INVALID_BATCH', 400, '申请清单无效');
    }
    applicationPublicIds.forEach(validUuid);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat || chat.status !== 'ACTIVE') throw storeError('CHAT_NOT_WRITABLE', 409, 'Chat 不可发文');
      const [[channel]] = await db.execute(`SELECT id FROM exchange_channels
        WHERE workspace_id=? AND id=? FOR UPDATE`, [auth.workspace_id, channelId]);
      if (!channel) throw storeError('CHANNEL_NOT_FOUND', 404, '通道不存在');
      const [[pending]] = await db.execute(`SELECT COUNT(*) AS count FROM cases k
        WHERE k.workspace_id=? AND k.chat_id=? AND NOT EXISTS (
          SELECT 1 FROM case_sop_versions s WHERE s.workspace_id=k.workspace_id
            AND s.chat_id=k.chat_id AND s.case_id=k.id AND s.status='LOCKED')`,
      [auth.workspace_id, chat.id]);
      if (Number(pending.count) !== 0) throw storeError('SOP_NOT_LOCKED', 409, '仍有 Case 未锁定 SOP');
      const placeholders = applicationPublicIds.map(() => '?').join(',');
      const [applications] = await db.execute(`SELECT id,public_id,status,business_date,channel_id,file_type
        FROM applications WHERE workspace_id=? AND chat_id=? AND public_id IN (${placeholders}) FOR UPDATE`,
      [auth.workspace_id, chat.id, ...applicationPublicIds]);
      if (applications.length !== applicationPublicIds.length || applications.some(app => app.status !== 'READY'
        || String(app.channel_id) !== String(channelId)
        || (app.business_date instanceof Date ? app.business_date.toISOString().slice(0, 10)
          : String(app.business_date).slice(0, 10)) !== date)) {
        throw storeError('BATCH_APPLICATION_MISMATCH', 409, '申请归属、日期或状态不一致');
      }
      const [[last]] = await db.execute(`SELECT COALESCE(MAX(batch_number),0) AS number FROM exchange_batches
        WHERE workspace_id=? AND chat_id=? AND channel_id=? AND business_date=?`,
      [auth.workspace_id, chat.id, channelId, date]);
      const number = Number(last.number) + 1;
      const publicId = crypto.randomUUID();
      const [batch] = await db.execute(`INSERT INTO exchange_batches
        (public_id,workspace_id,chat_id,channel_id,business_date,batch_number)
        VALUES (?,?,?,?,?,?)`, [publicId, auth.workspace_id, chat.id, channelId, date, number]);
      for (const app of applications) {
        await db.execute(`INSERT INTO batch_applications
          (workspace_id,chat_id,channel_id,batch_id,application_id,file_type)
          VALUES (?,?,?,?,?,?)`,
        [auth.workspace_id, chat.id, channelId, batch.insertId, app.id, app.file_type]);
        const [updated] = await db.execute(`UPDATE applications SET status='BATCHED'
          WHERE workspace_id=? AND chat_id=? AND id=? AND status='READY'`,
        [auth.workspace_id, chat.id, app.id]);
        if (updated.affectedRows !== 1) throw storeError('BATCH_APPLICATION_MISMATCH', 409, '申请已归入其他批次');
      }
      return { publicId, batchNumber: number };
    });
  }

  async function matchReturnRecord(token, { returnRecordId, applicationPublicId }) {
    validId(returnRecordId); validUuid(applicationPublicId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[item]] = await db.execute(`SELECT id,channel_id,file_type,record_json,match_status
        FROM return_records WHERE workspace_id=? AND id=? FOR UPDATE`,
      [auth.workspace_id, returnRecordId]);
      if (!item) throw storeError('RETURN_NOT_FOUND', 404, '回传记录不存在');
      if (item.match_status !== 'UNMATCHED') throw storeError('RETURN_ALREADY_MATCHED', 409, '回传记录已处理');
      if (!['02', '04'].includes(item.file_type)) throw storeError('RETURN_NOT_APPLICATION', 409, '该回传需单独对账');
      const [[app]] = await db.execute(`SELECT id,chat_id,case_id,app_no,file_type,business_code,record_json,status
        FROM applications WHERE workspace_id=? AND channel_id=? AND public_id=?`,
      [auth.workspace_id, item.channel_id, applicationPublicId]);
      const record = typeof item.record_json === 'string' ? JSON.parse(item.record_json) : item.record_json;
      const source = app && (typeof app.record_json === 'string' ? JSON.parse(app.record_json) : app.record_json);
      const expectedCode = app && (item.file_type === '02'
        ? String(Number(app.business_code) + 100).padStart(3, '0') : confirmationCodeFor(app.business_code));
      const commonFields = item.file_type === '02'
        ? ['DistributorCode','TransactionDate','TransactionAccountID','CertificateType','CertificateNo']
        : ['DistributorCode','TransactionDate','TransactionAccountID','TAAccountID','FundCode','ShareClass'];
      const keyMismatch = !source || commonFields.some(name => {
        const original = source[name];
        return original !== null && original !== undefined && String(original).trim() !== ''
          && String(record[name] ?? '').trim() !== String(original).trim();
      });
      if (!app || app.app_no !== record.AppSheetSerialNo || expectedCode !== record.BusinessCode
        || keyMismatch
        || (item.file_type === '02' ? app.file_type !== '01' : app.file_type !== '03')
        || !['DELIVERED', 'WAITING_RETURN'].includes(app.status)) {
        throw storeError('RETURN_MISMATCH', 409, '回传与已交付申请不一致');
      }
      await db.execute(`UPDATE return_records SET chat_id=?,case_id=?,application_id=?,match_status='MATCHED'
        WHERE workspace_id=? AND id=? AND match_status='UNMATCHED'`,
      [app.chat_id, app.case_id, app.id, auth.workspace_id, item.id]);
      return { matched: true };
    });
  }

  return Object.freeze({ stageApplication, createOutboundBatch, saveInboundFile, matchReturnRecord });
}
