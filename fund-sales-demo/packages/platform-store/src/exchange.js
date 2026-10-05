import crypto from 'node:crypto';
import { buildDataFile, confirmationCodeFor, dataFileName, encodeRecord, FIELD_REQUIREMENTS, parseDataFile } from '../../platform-protocol/src/index.js';
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

  async function listChannels(token) {
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [rows] = await db.execute(`SELECT id,channel_name,ta_environment,ta_code,
        distributor_code,protocol_version FROM exchange_channels
        WHERE workspace_id=? ORDER BY id`, [auth.workspace_id]);
      return { channels: rows.map(row => ({ id: String(row.id), name: row.channel_name,
        environment: row.ta_environment, taCode: row.ta_code,
        distributorCode: row.distributor_code, protocolVersion: row.protocol_version })) };
    });
  }

  async function listCaseApplications(token, { chatPublicId, casePublicId }) {
    validUuid(chatPublicId); validUuid(casePublicId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [rows] = await db.execute(`SELECT a.public_id,a.file_type,a.business_code,a.status,a.app_no,
        a.record_json,DATE_FORMAT(a.business_date,'%Y%m%d') AS business_date,
        a.channel_id,b.public_id AS batch_public_id
        FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
        JOIN applications a ON a.workspace_id=k.workspace_id AND a.chat_id=k.chat_id AND a.case_id=k.id
        LEFT JOIN batch_applications ba ON ba.workspace_id=a.workspace_id
          AND ba.chat_id=a.chat_id AND ba.application_id=a.id
        LEFT JOIN exchange_batches b ON b.workspace_id=ba.workspace_id
          AND b.chat_id=ba.chat_id AND b.id=ba.batch_id
        WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=? ORDER BY a.id`,
      [auth.workspace_id, chatPublicId, casePublicId]);
      return { applications: rows.map(row => ({ publicId: row.public_id,
        fileType: row.file_type, businessCode: row.business_code, status: row.status,
        applicationNumber: row.app_no, record: typeof row.record_json === 'string'
          ? JSON.parse(row.record_json) : row.record_json,
        businessDate: row.business_date, channelId: String(row.channel_id),
        batchPublicId: row.batch_public_id })) };
    });
  }

  async function listCaseBindings(token, { chatPublicId, casePublicId }) {
    validUuid(chatPublicId); validUuid(casePublicId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [rows] = await db.execute(`SELECT a.account_no,b.channel_id,b.ta_account_id,
        b.source_return_record_id
        FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
        JOIN case_generated_accounts a ON a.workspace_id=k.workspace_id
          AND a.chat_id=k.chat_id AND a.case_id=k.id
        JOIN ta_account_bindings b ON b.workspace_id=a.workspace_id
          AND b.transaction_account_id=a.account_no
        WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=? ORDER BY a.id,b.channel_id`,
      [auth.workspace_id, chatPublicId, casePublicId]);
      return { bindings: rows.map(row => ({ transactionAccountId: row.account_no,
        channelId: String(row.channel_id), taAccountId: row.ta_account_id,
        sourceReturnRecordId: String(row.source_return_record_id) })) };
    });
  }

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
          AND EXISTS (SELECT 1 FROM case_data_confirmations d
            WHERE d.workspace_id=k.workspace_id AND d.chat_id=k.chat_id AND d.case_id=k.id)
          AND s.id=? AND h.id=?`,
      [auth.workspace_id, chatPublicId, casePublicId, sopVersionId, channelId]);
      if (!scope) throw storeError('APPLICATION_SCOPE', 409, 'Case、SOP 或通道不可用于申请');
      const { snapshot, hash } = validSnapshot(fileType, record, scope.protocol_version, scope, businessDate);
      const [[sourceAccount]] = await db.execute(`SELECT a.id,a.branch_code,c.name,c.investor_type
        FROM case_generated_accounts a JOIN case_generated_customers c
          ON c.workspace_id=a.workspace_id AND c.chat_id=a.chat_id
          AND c.case_id=a.case_id AND c.id=a.customer_id
        WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND a.account_no=?`,
      [auth.workspace_id, scope.chat_id, scope.case_id, record.TransactionAccountID]);
      if (!sourceAccount || (record.BranchCode && sourceAccount.branch_code !== record.BranchCode) ||
          (record.IndividualOrInstitution &&
            sourceAccount.investor_type !== record.IndividualOrInstitution) ||
          (fileType === '01' && (sourceAccount.name !== record.InvestorName ||
            sourceAccount.investor_type !== record.IndividualOrInstitution))) {
        throw storeError('APPLICATION_DATA_MISMATCH', 409, '申请账户或客户信息与已确认数据不一致');
      }
      if (fileType === '03' && record.FundCode) {
        const hasShareClass = record.ShareClass !== undefined && record.ShareClass !== null &&
          String(record.ShareClass).trim() !== '';
        const [[sourceFund]] = await db.execute(`SELECT id FROM case_generated_funds
          WHERE workspace_id=? AND chat_id=? AND case_id=? AND fund_code=?
          ${hasShareClass ? 'AND share_class=?' : ''} LIMIT 1`,
        [auth.workspace_id, scope.chat_id, scope.case_id, record.FundCode,
          ...(hasShareClass ? [record.ShareClass] : [])]);
        if (!sourceFund) throw storeError('APPLICATION_DATA_MISMATCH', 409, '申请基金与已确认数据不一致');
      }
      if (fileType === '03' || record.BusinessCode !== '001') {
        const [[binding]] = await db.execute(`SELECT id FROM ta_account_bindings
          WHERE workspace_id=? AND channel_id=? AND transaction_account_id=? AND ta_account_id=?`,
        [auth.workspace_id, scope.channel_id, record.TransactionAccountID, record.TAAccountID]);
        if (!binding) throw storeError('TA_ACCOUNT_UNVERIFIED', 409, 'TA 账号尚无已确认来源');
      }
      const [[prior]] = await db.execute(`SELECT public_id,chat_id,case_id,sop_version_id,
        snapshot_hash FROM applications WHERE workspace_id=? AND channel_id=? AND app_no=? FOR UPDATE`,
      [auth.workspace_id, scope.channel_id, record.AppSheetSerialNo]);
      if (prior) {
        if (String(prior.chat_id) !== String(scope.chat_id) ||
            String(prior.case_id) !== String(scope.case_id) ||
            String(prior.sop_version_id) !== String(scope.sop_id) || prior.snapshot_hash !== hash) {
          throw storeError('APPLICATION_NUMBER_CONFLICT', 409, '申请号已经对应另一份申请');
        }
        return { publicId: prior.public_id, snapshotHash: hash, replayed: true };
      }
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
      const [[missingReview]] = await db.execute(`SELECT COUNT(*) AS count FROM cases k
        LEFT JOIN case_data_confirmations d ON d.workspace_id=k.workspace_id
          AND d.chat_id=k.chat_id AND d.case_id=k.id
        WHERE k.workspace_id=? AND k.chat_id=? AND d.case_id IS NULL`,
      [auth.workspace_id, chat.id]);
      if (Number(missingReview.count)) {
        throw storeError('DATA_NOT_CONFIRMED', 409, '仍有 Case 的模拟数据未确认');
      }
      const placeholders = applicationPublicIds.map(() => '?').join(',');
      const [applications] = await db.execute(`SELECT a.id,a.public_id,a.status,
        DATE_FORMAT(a.business_date, '%Y-%m-%d') AS business_date,a.channel_id,a.file_type,
        b.public_id AS prior_batch_public_id
        FROM applications a LEFT JOIN batch_applications ba
          ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id
        LEFT JOIN exchange_batches b ON b.workspace_id=ba.workspace_id
          AND b.chat_id=ba.chat_id AND b.id=ba.batch_id
        WHERE a.workspace_id=? AND a.chat_id=? AND a.public_id IN (${placeholders}) FOR UPDATE`,
      [auth.workspace_id, chat.id, ...applicationPublicIds]);
      if (applications.length !== applicationPublicIds.length || applications.some(app =>
        String(app.channel_id) !== String(channelId)
        || String(app.business_date) !== date)) {
        throw storeError('BATCH_APPLICATION_MISMATCH', 409, '申请归属、日期或状态不一致');
      }
      const priorBatches = new Set(applications.map(app => app.prior_batch_public_id));
      if (priorBatches.size === 1 && Boolean(applications[0].prior_batch_public_id) &&
          applications.every(app => ['BATCHED', 'GENERATED'].includes(app.status))) {
        const [priorMembers] = await db.execute(`SELECT a.public_id
          FROM exchange_batches b JOIN batch_applications ba
            ON ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.id
          JOIN applications a ON a.workspace_id=ba.workspace_id
            AND a.chat_id=ba.chat_id AND a.id=ba.application_id
          WHERE b.workspace_id=? AND b.chat_id=? AND b.public_id=? FOR UPDATE`,
        [auth.workspace_id, chat.id, applications[0].prior_batch_public_id]);
        if (priorMembers.length !== applicationPublicIds.length ||
            priorMembers.some(member => !applicationPublicIds.includes(member.public_id))) {
          throw storeError('BATCH_APPLICATION_MISMATCH', 409, '申请清单与已有批次不一致');
        }
        return { publicId: applications[0].prior_batch_public_id, replayed: true };
      }
      if (applications.some(app => app.status !== 'READY' || app.prior_batch_public_id)) {
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

  async function generateOutboundFiles(token, { chatPublicId, batchPublicId }) {
    validUuid(chatPublicId); validUuid(batchPublicId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[batch]] = await db.execute(`SELECT b.id,b.status,b.channel_id,
        DATE_FORMAT(b.business_date,'%Y%m%d') AS business_date,
        h.ta_code,h.distributor_code,h.protocol_version
        FROM exchange_batches b
        JOIN case_chats c ON c.workspace_id=b.workspace_id AND c.id=b.chat_id
        JOIN exchange_channels h ON h.workspace_id=b.workspace_id AND h.id=b.channel_id
        WHERE b.workspace_id=? AND c.public_id=? AND b.public_id=?
          AND c.status='ACTIVE' FOR UPDATE`, [auth.workspace_id, chatPublicId, batchPublicId]);
      if (!batch) throw storeError('BATCH_NOT_FOUND', 404, '批次不存在');
      if (batch.status === 'GENERATED') {
        const [files] = await db.execute(`SELECT id,file_name,file_type,content_sha256,record_count
          FROM exchange_files WHERE workspace_id=? AND chat_id=(SELECT id FROM case_chats
            WHERE workspace_id=? AND public_id=?) AND batch_id=? AND direction='OUTBOUND'
          ORDER BY file_type`, [auth.workspace_id, auth.workspace_id, chatPublicId, batch.id]);
        if (!files.length) throw storeError('BATCH_INCOMPLETE', 409, '批次状态与文件不一致');
        return { batchPublicId, files: files.map(fileSummary), replayed: true };
      }
      if (batch.status !== 'DRAFT') throw storeError('BATCH_NOT_GENERATABLE', 409, '批次不能生成文件');
      await db.execute(`SELECT id FROM exchange_channels WHERE workspace_id=? AND id=? FOR UPDATE`,
        [auth.workspace_id, batch.channel_id]);
      const [apps] = await db.execute(`SELECT a.id,a.file_type,a.status,a.record_json
        FROM batch_applications ba JOIN applications a
          ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id
        WHERE ba.workspace_id=? AND ba.batch_id=? ORDER BY a.file_type,a.id FOR UPDATE`,
      [auth.workspace_id, batch.id]);
      if (!apps.length || apps.some(app => app.status !== 'BATCHED')) {
        throw storeError('BATCH_INCOMPLETE', 409, '批次申请不完整');
      }
      const files = [];
      for (const fileType of ['01', '03']) {
        const selected = apps.filter(app => app.file_type === fileType);
        if (!selected.length) continue;
        const records = selected.map(app => typeof app.record_json === 'string'
          ? JSON.parse(app.record_json) : app.record_json);
        const [prior] = await db.execute(`SELECT file_name FROM exchange_files
          WHERE workspace_id=? AND channel_id=? AND direction='OUTBOUND'
            AND file_type=? AND file_name LIKE ? FOR UPDATE`,
        [auth.workspace_id, batch.channel_id, fileType,
          `OFD_${batch.distributor_code}_${batch.ta_code}_${batch.business_date}_${fileType}%`]);
        const used = new Set(prior.map(row => row.file_name));
        let sequence = 1;
        let fileName;
        do {
          fileName = dataFileName({ creator: batch.distributor_code,
            receiver: batch.ta_code, date: batch.business_date, fileType, sequence });
          sequence += 1;
        } while (used.has(fileName) && sequence <= 1000);
        if (used.has(fileName)) throw storeError('FILE_SEQUENCE_EXHAUSTED', 409, '当日文件序号已用尽');
        const raw = buildDataFile({ creator: batch.distributor_code, receiver: batch.ta_code,
          date: batch.business_date, summaryNo: sequence - 1, fileType, records,
          version: batch.protocol_version });
        const digest = crypto.createHash('sha256').update(raw).digest('hex');
        const [saved] = await db.execute(`INSERT INTO exchange_files
          (workspace_id,channel_id,chat_id,batch_id,direction,file_type,file_name,
           content_sha256,raw_bytes,record_count)
          VALUES (?, ?, (SELECT id FROM case_chats WHERE workspace_id=? AND public_id=?),
            ?, 'OUTBOUND', ?, ?, ?, ?, ?)`,
        [auth.workspace_id, batch.channel_id, auth.workspace_id, chatPublicId, batch.id,
          fileType, fileName, digest, raw, selected.length]);
        files.push(fileSummary({ id: saved.insertId, file_name: fileName,
          file_type: fileType, content_sha256: digest, record_count: selected.length }));
      }
      await db.execute(`UPDATE applications a JOIN batch_applications ba
        ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id
        SET a.status='GENERATED' WHERE ba.workspace_id=? AND ba.batch_id=? AND a.status='BATCHED'`,
      [auth.workspace_id, batch.id]);
      await db.execute(`UPDATE exchange_batches SET status='GENERATED'
        WHERE workspace_id=? AND id=? AND status='DRAFT'`, [auth.workspace_id, batch.id]);
      return { batchPublicId, files, replayed: false };
    });
  }

  async function listOutboundFiles(token, chatPublicId) {
    validUuid(chatPublicId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [rows] = await db.execute(`SELECT f.id,f.file_name,f.file_type,f.content_sha256,f.record_count,
        b.public_id AS batch_public_id,b.status AS batch_status
        FROM case_chats c JOIN exchange_batches b ON b.workspace_id=c.workspace_id AND b.chat_id=c.id
        JOIN exchange_files f ON f.workspace_id=b.workspace_id AND f.chat_id=b.chat_id AND f.batch_id=b.id
        WHERE c.workspace_id=? AND c.public_id=? AND f.direction='OUTBOUND'
        ORDER BY f.id DESC`, [auth.workspace_id, chatPublicId]);
      return { files: rows.map(row => ({ ...fileSummary(row), batchPublicId: row.batch_public_id,
        batchStatus: row.batch_status })) };
    });
  }

  async function readOutboundFile(token, { chatPublicId, fileId }) {
    validUuid(chatPublicId); validId(fileId);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[file]] = await db.execute(`SELECT f.file_name,f.raw_bytes,f.content_sha256
        FROM exchange_files f JOIN case_chats c ON c.workspace_id=f.workspace_id AND c.id=f.chat_id
        WHERE f.workspace_id=? AND c.public_id=? AND f.id=? AND f.direction='OUTBOUND'`,
      [auth.workspace_id, chatPublicId, fileId]);
      if (!file) throw storeError('FILE_NOT_FOUND', 404, '文件不存在');
      return { fileName: file.file_name, rawBytes: file.raw_bytes,
        sha256: file.content_sha256 };
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
        ? ['DistributorCode','TransactionDate','TransactionAccountID','TAAccountID','CertificateType','CertificateNo']
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
      let createBinding = false;
      if (item.file_type === '02' && record.ReturnCode === '0000') {
        if (!record.TAAccountID || !record.TransactionAccountID) {
          throw storeError('RETURN_MISMATCH', 409, '成功的 02 回传缺少真实 TA 账号');
        }
        const [[binding]] = await db.execute(`SELECT ta_account_id FROM ta_account_bindings
          WHERE workspace_id=? AND channel_id=? AND transaction_account_id=? FOR UPDATE`,
        [auth.workspace_id, item.channel_id, record.TransactionAccountID]);
        if (binding && binding.ta_account_id !== record.TAAccountID) {
          throw storeError('RETURN_MISMATCH', 409, '02 回传的 TA 账号与已确认账号冲突');
        }
        createBinding = !binding;
      }
      await db.execute(`UPDATE return_records SET chat_id=?,case_id=?,application_id=?,match_status='MATCHED'
        WHERE workspace_id=? AND id=? AND match_status='UNMATCHED'`,
      [app.chat_id, app.case_id, app.id, auth.workspace_id, item.id]);
      if (createBinding) {
        await db.execute(`INSERT INTO ta_account_bindings
          (workspace_id,channel_id,transaction_account_id,ta_account_id,source_return_record_id)
          VALUES (?,?,?,?,?)`,
        [auth.workspace_id, item.channel_id, record.TransactionAccountID, record.TAAccountID, item.id]);
      }
      return { matched: true };
    });
  }

  return Object.freeze({ listChannels, listCaseApplications, listCaseBindings, stageApplication,
    createOutboundBatch, generateOutboundFiles,
    listOutboundFiles, readOutboundFile, saveInboundFile, matchReturnRecord });
}

function fileSummary(row) {
  return { id: String(row.id), fileName: row.file_name, fileType: row.file_type,
    sha256: row.content_sha256, recordCount: Number(row.record_count) };
}
