import { checkExchangeOrder, recordExchangeEvent } from './exchange-order.js';
import crypto from 'node:crypto';
import { authenticateSession, storeError } from './index.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const digest = record => crypto.createHash('sha256').update(JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
const error = (code, message) => storeError(code, 409, message);

export function createReturnConfirmationRepository({ transaction }) {
  async function context(db, token, scope, write = false) {
    if (![scope.chatPublicId, scope.casePublicId].every(value => uuid.test(value ?? ''))) {
      throw storeError('INVALID_INPUT', 400, 'Chat 或 Case 标识无效');
    }
    const auth = await authenticateSession(db, token);
    const [[owner]] = await db.execute(`SELECT k.id AS case_id,c.id AS chat_id,c.status AS chat_status,k.status AS case_status
      FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
      WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=?${write ? ' FOR UPDATE' : ''}`,
    [auth.workspace_id, scope.chatPublicId, scope.casePublicId]);
    if (!owner) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
    if (write && (owner.chat_status !== 'ACTIVE' || ['PASS','FAIL'].includes(owner.case_status))) {
      throw error('CASE_NOT_WRITABLE', 'Chat 或 Case 已结束，不能修改确认数据');
    }
    return { auth, keys: [auth.workspace_id, owner.chat_id, owner.case_id] };
  }

  async function read(token, scope) {
    return transaction(async db => {
      const { keys } = await context(db, token, scope);
      const [batches] = await db.execute(`SELECT DISTINCT b.public_id AS batchPublicId,b.status
        FROM applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id
        JOIN exchange_batches b ON b.workspace_id=ba.workspace_id AND b.chat_id=ba.chat_id AND b.id=ba.batch_id
        WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? ORDER BY b.public_id`, keys);
      const [confirmations] = await db.execute(`SELECT a.public_id AS applicationPublicId,r.return_code AS returnCode,r.outcome,
        CAST(r.parse_id AS CHAR) AS parseId,r.record_index AS recordIndex FROM sales_return_confirmations r
        JOIN applications a ON a.workspace_id=r.workspace_id AND a.id=r.application_id
        WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? ORDER BY r.id`, keys);
      return { batches, confirmations };
    });
  }

  async function delivery(token, input) {
    if (!uuid.test(input.batchPublicId ?? '') || (input.exchangeSteps !== undefined &&
        (!Array.isArray(input.exchangeSteps) || input.exchangeSteps.length>200 ||
          input.exchangeSteps.some(step=>!step || Object.keys(step).length!==3 ||
            !uuid.test(step.casePublicId??'') || !['01','03'].includes(step.fileType) || typeof step.stepId!=='string') ||
          new Set(input.exchangeSteps.map(step=>step.casePublicId+step.fileType)).size!==input.exchangeSteps.length))) {
      throw storeError('INVALID_INPUT',400,'批次或各Case的发送步骤映射无效');
    }
    return transaction(async db => {
      const { auth, keys } = await context(db,token,input,true);
      const [[batch]] = await db.execute(`SELECT b.id,b.status,DATE_FORMAT(b.business_date,'%Y%m%d') AS business_date
        FROM exchange_batches b WHERE b.workspace_id=? AND b.chat_id=? AND b.public_id=? AND EXISTS
          (SELECT 1 FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id
            AND a.chat_id=ba.chat_id AND a.id=ba.application_id
            WHERE ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.id AND a.case_id=?) FOR UPDATE`,
        [keys[0],keys[1],input.batchPublicId,keys[2]]);
      if(!batch) throw storeError('BATCH_NOT_FOUND',404,'批次不存在');
      const [members] = await db.execute(`SELECT DISTINCT k.id AS case_id,k.public_id AS case_public_id,k.status AS case_status,a.file_type
        FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id
        JOIN cases k ON k.workspace_id=a.workspace_id AND k.chat_id=a.chat_id AND k.id=a.case_id
        WHERE ba.workspace_id=? AND ba.chat_id=? AND ba.batch_id=? ORDER BY k.id,a.file_type FOR UPDATE`,[keys[0],keys[1],batch.id]);
      if(input.exchangeSteps?.some(step=>!members.some(member=>member.case_public_id===step.casePublicId && member.file_type===step.fileType))) {
        throw storeError('EXCHANGE_MAPPING_INVALID',409,'步骤映射包含不属于此批次的Case或文件类型');
      }
      const orders=[];
      for(const member of members) {
        if(['PASS','FAIL'].includes(member.case_status))throw error('CASE_NOT_WRITABLE','批次含已结束Case，不能登记实际发送');
        const stepId=input.exchangeSteps?.find(step=>step.casePublicId===member.case_public_id && step.fileType===member.file_type)?.stepId ??
          (member.case_public_id===input.casePublicId && members.filter(row=>row.case_id===member.case_id).length===1 ? input.exchangeStepId : undefined);
        const memberKeys=[keys[0],keys[1],member.case_id];
        const checked=await checkExchangeOrder(db,memberKeys,{stepId,direction:'SEND',fileType:member.file_type,
          businessDate:batch.business_date,batchId:batch.id,condition:'SENT'});
        orders.push({keys:memberKeys,checked,member});
      }
      const duplicate=['DELIVERED','RECEIVED'].includes(batch.status);
      if(!duplicate) {
        if(batch.status!=='GENERATED')throw error('BATCH_NOT_GENERATED','须先生成完整申请文件');
        const [[missing]]=await db.execute(`SELECT COUNT(*) AS n FROM batch_applications ba
          WHERE ba.workspace_id=? AND ba.chat_id=? AND ba.batch_id=? AND NOT EXISTS
          (SELECT 1 FROM exchange_files f WHERE f.workspace_id=ba.workspace_id AND f.chat_id=ba.chat_id
            AND f.batch_id=ba.batch_id AND f.direction='OUTBOUND' AND f.file_type=ba.file_type)`,[keys[0],keys[1],batch.id]);
        if(Number(missing.n))throw error('BATCH_NOT_GENERATED','批次仍有申请文件未生成');
        await db.execute(`UPDATE exchange_batches SET status='DELIVERED',delivered_at=CURRENT_TIMESTAMP(3)
          WHERE workspace_id=? AND chat_id=? AND id=?`,[auth.workspace_id,keys[1],batch.id]);
        await db.execute(`UPDATE applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id
          AND ba.chat_id=a.chat_id AND ba.application_id=a.id SET a.status='WAITING_RETURN'
          WHERE ba.workspace_id=? AND ba.chat_id=? AND ba.batch_id=? AND a.status='GENERATED'`,[keys[0],keys[1],batch.id]);
      }
      for(const order of orders) await recordExchangeEvent(db,order.keys,order.checked,{condition:'SENT',batchId:batch.id});
      return {delivered:true,duplicate,message:'已按各Case和文件类型核验整批发送步骤',steps:orders.map(order=>({
        casePublicId:order.member.case_public_id,fileType:order.member.file_type,stepId:order.checked.step.stepId}))};
    });
  }

  async function inboundRecord(db, keys, channelId, parseId, file, localIndex, record, app) {
    const [[raw]] = await db.execute(`SELECT raw_bytes,content_sha256 FROM case_return_parse_files
      WHERE workspace_id=? AND chat_id=? AND case_id=? AND parse_id=? AND file_name=? FOR UPDATE`,
    [...keys, parseId, file.fileName]);
    if (!raw || raw.content_sha256 !== file.sha256 || crypto.createHash('sha256').update(raw.raw_bytes).digest('hex') !== file.sha256) {
      throw error('RETURN_SOURCE_INVALID', '原始回传文件缺失或摘要不一致');
    }
    const [[priorFile]] = await db.execute(`SELECT id,content_sha256 FROM exchange_files
      WHERE workspace_id=? AND channel_id=? AND file_name=? FOR UPDATE`, [keys[0], channelId, file.fileName]);
    if (priorFile && priorFile.content_sha256 !== file.sha256) throw error('FILE_NAME_CONFLICT', '同名回传文件内容不同');
    let fileId = priorFile?.id;
    if (!fileId) {
      const [[same]] = await db.execute(`SELECT id FROM exchange_files WHERE workspace_id=? AND channel_id=?
        AND direction='INBOUND' AND content_sha256=? FOR UPDATE`, [keys[0], channelId, file.sha256]);
      fileId = same?.id;
    }
    if (!fileId) {
      const [saved] = await db.execute(`INSERT INTO exchange_files
        (workspace_id,channel_id,direction,file_type,file_name,content_sha256,raw_bytes,record_count)
        VALUES (?,?,'INBOUND',?,?,?,?,?)`, [keys[0], channelId, file.fileType, file.fileName, file.sha256, raw.raw_bytes, file.records.length]);
      fileId = saved.insertId;
    }
    const [[prior]] = await db.execute(`SELECT id,record_json,application_id,match_status FROM return_records
      WHERE workspace_id=? AND file_id=? AND record_index=? FOR UPDATE`, [keys[0], fileId, localIndex + 1]);
    if (prior) {
      if (digest(json(prior.record_json)) !== digest(record) || (prior.match_status !== 'UNMATCHED' && String(prior.application_id) !== String(app.id))) {
        throw error('RETURN_SOURCE_CONFLICT', '原回传记录已归属其他申请或内容不一致');
      }
      await db.execute(`UPDATE return_records SET chat_id=?,case_id=?,application_id=?,match_status='MATCHED'
        WHERE workspace_id=? AND id=?`, [keys[1], keys[2], app.id, keys[0], prior.id]);
      return prior.id;
    }
    const [saved] = await db.execute(`INSERT INTO return_records
      (workspace_id,channel_id,file_id,file_type,record_index,record_json,chat_id,case_id,application_id,match_status)
      VALUES (?,?,?,?,?,?,?,?,?,'MATCHED')`, [keys[0], channelId, fileId, file.fileType, localIndex + 1,
      JSON.stringify(record), keys[1], keys[2], app.id]);
    return saved.insertId;
  }

  async function apply(token, input, runGraph) {
    if (!/^[1-9]\d{0,18}$/.test(String(input.parseId ?? '')) || !Array.isArray(input.recordIndexes) ||
        !input.recordIndexes.length || input.recordIndexes.length > 2000 || new Set(input.recordIndexes).size !== input.recordIndexes.length ||
        input.recordIndexes.some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw storeError('INVALID_INPUT', 400, '请选择有效且不重复的回传记录');
    }
    return transaction(async db => {
      const { auth, keys } = await context(db, token, input, true);
      const [[parsed]] = await db.execute(`SELECT p.parsed_json,p.expected_type,b.id AS batch_id,b.channel_id,b.status,
        h.ta_code,h.distributor_code,h.protocol_version FROM case_return_parses p
        JOIN exchange_batches b ON b.workspace_id=p.workspace_id AND b.chat_id=p.chat_id AND b.id=p.batch_id
        JOIN exchange_channels h ON h.workspace_id=b.workspace_id AND h.id=b.channel_id
        WHERE p.workspace_id=? AND p.chat_id=? AND p.case_id=? AND p.id=? FOR UPDATE`, [...keys, input.parseId]);
      if (!parsed) throw storeError('PARSE_NOT_FOUND', 404, '解析记录不存在');
      if (!['DELIVERED','RECEIVED'].includes(parsed.status)) throw error('APPLICATION_NOT_DELIVERED', '须先确认对应申请文件已实际发送至 TA');
      await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? AND id=? FOR UPDATE', [keys[0], parsed.channel_id]);
      const packageResult = json(parsed.parsed_json);
      const order=await checkExchangeOrder(db,keys,{stepId:input.exchangeStepId,direction:'RECEIVE',fileType:parsed.expected_type,businessDate:packageResult.files[0]?.date,batchId:parsed.batch_id,parseId:input.parseId,condition:'CONFIRMED'});
      if(!order.events.some(e=>e.stepId===order.step.stepId && e.condition==='PARSED' && String(e.parse_id)===String(input.parseId))) throw error('ORDER_VIOLATION','本回传未通过上传时序校验，请补齐前置步骤后重新上传或重试解析');
      const rows = packageResult.files.flatMap(file => file.records.map((record, localIndex) => ({ file, record, localIndex })));
      if (input.recordIndexes.some(index => index >= rows.length)) throw storeError('INVALID_INPUT', 400, '回传记录序号不存在');
      const results = [];
      for (const index of [...input.recordIndexes].sort((a, b) => a - b)) {
        const { file, record, localIndex } = rows[index];
        const [[app]] = await db.execute(`SELECT a.id,a.public_id,a.file_type,a.business_code,a.record_json,a.status
          FROM applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id
           AND ba.chat_id=a.chat_id AND ba.application_id=a.id
          WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND a.channel_id=?
           AND ba.batch_id=? AND a.app_no=? FOR UPDATE`, [...keys, parsed.channel_id, parsed.batch_id, record.AppSheetSerialNo ?? '']);
        if (!app) throw error('RETURN_MISMATCH', '回传申请号不属于当前 Case 的对应批次');
        const recordHash = digest(record);
        const [[prior]] = await db.execute(`SELECT record_sha256,outcome FROM sales_return_confirmations
          WHERE workspace_id=? AND application_id=? FOR UPDATE`, [keys[0], app.id]);
        if (prior) {
          if (prior.record_sha256 !== recordHash) throw error('CONFIRMATION_CONFLICT', '该申请已有不同确认，需单独处理更正，不能覆盖');
          results.push({ applicationPublicId: app.public_id, outcome: prior.outcome, duplicate: true });
          continue;
        }
        const source = json(app.record_json);
        const applied = await runGraph({ expectedType: parsed.expected_type,
          application: { fileType: app.file_type, businessCode: app.business_code, status: app.status, record: source },
          record, channel: { taCode: parsed.ta_code, distributorCode: parsed.distributor_code, protocolVersion: parsed.protocol_version },
          apply: async effect => {
            const returnRecordId = await inboundRecord(db, keys, parsed.channel_id, input.parseId, file, localIndex, record, app);
            const [saved] = await db.execute(`INSERT INTO sales_return_confirmations
              (workspace_id,chat_id,case_id,application_id,parse_id,record_index,record_sha256,return_code,outcome,record_json,actor_user_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...keys, app.id, input.parseId, index, recordHash,
              record.ReturnCode, effect.outcome, JSON.stringify(record), auth.user_id]);
            if (effect.outcome === 'CONFIRMED' && app.file_type === '01') {
              const [[binding]] = await db.execute(`SELECT ta_account_id FROM ta_account_bindings
                WHERE workspace_id=? AND channel_id=? AND transaction_account_id=? FOR UPDATE`,
              [keys[0], parsed.channel_id, record.TransactionAccountID]);
              if (binding && binding.ta_account_id !== record.TAAccountID) throw error('TA_ACCOUNT_CONFLICT', 'TA 账号与已有确认绑定冲突');
              const [[account]] = await db.execute(`SELECT id FROM sales_confirmed_accounts WHERE workspace_id=?
                AND channel_id=? AND transaction_account_id=? FOR UPDATE`, [keys[0], parsed.channel_id, record.TransactionAccountID]);
              if (account) throw error('ACCOUNT_ALREADY_CONFIRMED', '该账户已有开户确认，不能用另一份开户申请覆盖');
              await db.execute(`INSERT INTO sales_confirmed_accounts
                (public_id,workspace_id,channel_id,transaction_account_id,ta_account_id,investor_name,investor_type,certificate_type,certificate_no,branch_code,source_confirmation_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), keys[0], parsed.channel_id,
                effect.accountEffect.transactionAccountId, effect.accountEffect.taAccountId, effect.accountEffect.investorName, effect.accountEffect.investorType,
                effect.accountEffect.certificateType, effect.accountEffect.certificateNo, effect.accountEffect.branchCode, saved.insertId]);
              if (!binding) await db.execute(`INSERT INTO ta_account_bindings
                (workspace_id,channel_id,transaction_account_id,ta_account_id,source_return_record_id) VALUES (?,?,?,?,?)`,
              [keys[0], parsed.channel_id, record.TransactionAccountID, record.TAAccountID, returnRecordId]);
            }
            if (effect.outcome === 'CONFIRMED' && app.file_type === '03') {
              const [[account]] = await db.execute(`SELECT id FROM sales_confirmed_accounts WHERE workspace_id=?
                AND channel_id=? AND transaction_account_id=? AND ta_account_id=? FOR UPDATE`,
              [keys[0], parsed.channel_id, record.TransactionAccountID, record.TAAccountID]);
              if (!account) throw error('SALES_ACCOUNT_UNCONFIRMED', '销售正式账户尚无成功开户确认');
              await db.execute(`INSERT INTO sales_confirmed_transactions
                (workspace_id,channel_id,account_id,confirmation_id,business_code,fund_code,share_class,confirmed_amount,confirmed_volume,nav,confirmation_date)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [keys[0], parsed.channel_id, account.id, saved.insertId, app.business_code,
                effect.transactionEffect.fundCode, effect.transactionEffect.shareClass, effect.transactionEffect.confirmedAmount, effect.transactionEffect.confirmedVolume, effect.transactionEffect.nav,
                effect.transactionEffect.confirmationDate]);
              await db.execute(`INSERT INTO sales_confirmed_holdings
                (workspace_id,channel_id,account_id,fund_code,share_class,total_volume) VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE
                  total_volume=total_volume+IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),?,0),
                  available_volume=IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),NULL,available_volume),
                  frozen_volume=IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),NULL,frozen_volume)`, [keys[0], parsed.channel_id, account.id,
                effect.holdingEffect.fundCode, effect.holdingEffect.shareClass, effect.holdingEffect.volumeDelta,
                effect.transactionEffect.confirmationDate.replaceAll('-',''), effect.holdingEffect.volumeDelta,
                effect.transactionEffect.confirmationDate.replaceAll('-',''), effect.transactionEffect.confirmationDate.replaceAll('-','')]);
            }
            await db.execute(`UPDATE applications SET status=? WHERE workspace_id=? AND id=?`, [effect.outcome, keys[0], app.id]);
            return { applicationPublicId: app.public_id, outcome: effect.outcome, duplicate: false };
          } });
        results.push(applied);
      }
      const [[pending]]=await db.execute(`SELECT COUNT(*) AS n FROM applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND ba.batch_id=? AND a.file_type=? AND a.status<>'CONFIRMED' FOR UPDATE`,[...keys,parsed.batch_id,parsed.expected_type==='02'?'01':'03']);
      if(Number(pending.n)===0) await recordExchangeEvent(db,keys,order,{condition:'CONFIRMED',batchId:parsed.batch_id,parseId:input.parseId});
      return { businessApplied: true, results };
    });
  }

  async function selectAccount(token, input) {
    if (!uuid.test(input.accountPublicId ?? '')) throw storeError('INVALID_INPUT', 400, '账户标识无效');
    return transaction(async db => {
      const { keys } = await context(db, token, input, true);
      const [[staged]] = await db.execute(`SELECT id FROM applications WHERE workspace_id=? AND chat_id=? AND case_id=? LIMIT 1 FOR UPDATE`,keys);
      if (staged) throw error('APPLICATION_ALREADY_STAGED','已有申请，不能再切换申请账户；请新建 Case 选择已有账户');
      const [[account]] = await db.execute(`SELECT id,channel_id FROM sales_confirmed_accounts
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [keys[0],input.accountPublicId]);
      if (!account) throw storeError('SALES_ACCOUNT_NOT_FOUND', 404, '已确认账户不存在');
      await db.execute(`DELETE FROM case_sales_account_refs WHERE workspace_id=? AND chat_id=? AND case_id=?`,keys);
      await db.execute(`INSERT INTO case_sales_account_refs
        (workspace_id,chat_id,case_id,channel_id,account_id) VALUES (?,?,?,?,?)`, [...keys,account.channel_id,account.id]);
      return { selected: true };
    });
  }

  async function applicationData(token, scope, drafts) {
    return transaction(async db => {
      const { keys } = await context(db, token, scope);
      const [accounts] = await db.execute(`SELECT s.id,s.channel_id,s.transaction_account_id,s.branch_code,s.investor_name,s.investor_type
        FROM case_sales_account_refs r JOIN sales_confirmed_accounts s
          ON s.workspace_id=r.workspace_id AND s.channel_id=r.channel_id AND s.id=r.account_id
        WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? ORDER BY s.id`, keys);
      const referenceId = id => String(8000000000000000000n + BigInt(id));
      if (!accounts.length) return drafts;
      const [holdings] = await db.execute(`SELECT h.account_id,h.fund_code,h.share_class,h.total_volume FROM case_sales_account_refs r
        JOIN sales_confirmed_holdings h ON h.workspace_id=r.workspace_id AND h.channel_id=r.channel_id AND h.account_id=r.account_id
        WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=?`,keys);
      return { ...drafts, customers: accounts.map(a => ({ id: referenceId(a.id),
        name: a.investor_name,investor_type: a.investor_type,source: 'TA_CONFIRMED' })),
      accounts: accounts.map(a => ({ id: referenceId(a.id),customer_id: referenceId(a.id),
        account_no: a.transaction_account_id,branch_code: a.branch_code,channel_id: String(a.channel_id),source: 'TA_CONFIRMED' })),
      holdings: holdings.map(h => ({ account_id:referenceId(h.account_id),fund_code:h.fund_code,
        share_class:h.share_class,total_volume:h.total_volume,source:'TA_CONFIRMED' })) };

    });
  }

  async function salesData(token) {
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [accounts] = await db.execute(`SELECT public_id AS publicId,CAST(channel_id AS CHAR) AS channelId,
        transaction_account_id AS transactionAccountId,ta_account_id AS taAccountId,investor_name AS investorName,
        investor_type AS investorType,certificate_type AS certificateType,certificate_no AS certificateNo,
        branch_code AS branchCode FROM sales_confirmed_accounts WHERE workspace_id=? ORDER BY id`, [auth.workspace_id]);
      const [transactions] = await db.execute(`SELECT a.public_id AS applicationPublicId,CAST(t.channel_id AS CHAR) AS channelId,
        s.transaction_account_id AS transactionAccountId,s.ta_account_id AS taAccountId,t.business_code AS businessCode,
        t.fund_code AS fundCode,t.share_class AS shareClass,t.confirmed_amount AS confirmedAmount,
        t.confirmed_volume AS confirmedVolume,t.nav,DATE_FORMAT(t.confirmation_date,'%Y%m%d') AS confirmationDate
        FROM sales_confirmed_transactions t JOIN sales_return_confirmations r ON r.workspace_id=t.workspace_id AND r.id=t.confirmation_id
        JOIN applications a ON a.workspace_id=r.workspace_id AND a.id=r.application_id
        JOIN sales_confirmed_accounts s ON s.workspace_id=t.workspace_id AND s.channel_id=t.channel_id AND s.id=t.account_id
        WHERE t.workspace_id=? ORDER BY t.id`, [auth.workspace_id]);
      const [holdings] = await db.execute(`SELECT CAST(h.channel_id AS CHAR) AS channelId,s.transaction_account_id AS transactionAccountId,
        s.ta_account_id AS taAccountId,h.fund_code AS fundCode,h.share_class AS shareClass,h.total_volume AS totalVolume,
        h.available_volume AS availableVolume,h.frozen_volume AS frozenVolume,
        DATE_FORMAT(h.snapshot_date,'%Y%m%d') AS snapshotDate,h.snapshot_total AS snapshotTotal,
        CAST(h.snapshot_parse_id AS CHAR) AS snapshotParseId
        FROM sales_confirmed_holdings h JOIN sales_confirmed_accounts s ON s.workspace_id=h.workspace_id AND s.channel_id=h.channel_id AND s.id=h.account_id
        WHERE h.workspace_id=? ORDER BY h.channel_id,h.account_id,h.fund_code,h.share_class`, [auth.workspace_id]);
      return { source: 'TA_CONFIRMED', accounts, transactions, holdings };
    });
  }
  return Object.freeze({ read, delivery, apply, salesData, selectAccount, applicationData });
}
