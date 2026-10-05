import crypto from 'node:crypto';
import { scopeError } from './scope.js';
import { resolveProtocolReferences, persistProtocolReferences } from './references.js';

const forbiddenKeys = new Set(['workspaceId','workspace_id','chatId','chat_id','runId','run_id',
  'ownerUserId','owner_user_id','taEnvironmentId','ta_environment_id','taCode','ta_code','distributorCode','distributor_code']);
function payload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw scopeError('数据格式无效',400,'INVALID_INPUT');
  if (Object.keys(input).some(key => forbiddenKeys.has(key))) throw scopeError('不能由客户端指定数据归属',400,'SCOPE_OVERRIDE');
  return input;
}
const text = (value, length, name) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length>length) throw scopeError(`${name} 格式无效`,400,'INVALID_INPUT');
  return value.trim();
};
function decimal(value, { signed = false, nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || !(signed ? /^-?\d{1,14}(?:\.\d{1,2})?$/ : /^\d{1,14}(?:\.\d{1,2})?$/).test(value)) {
    throw scopeError('金额和份额必须使用精确的十进制字符串',400,'INVALID_DECIMAL');
  }
  return value;
}
function json(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw scopeError('字段资料必须为对象',400,'INVALID_INPUT');
  const result=JSON.stringify(value);
  if (Buffer.byteLength(result)>65536) throw scopeError('字段资料过大',400,'INVALID_INPUT');
  return result;
}
function pagination({ after = '0', limit = 50 } = {}) {
  if (!/^\d{1,20}$/.test(String(after)) || BigInt(after)>18446744073709551615n
    || !Number.isInteger(limit) || limit<1 || limit>100) throw scopeError('分页参数无效',400,'INVALID_INPUT');
  return [String(after),limit];
}
export function applicationPageQuery(page={}) {
  const {status}=page;
  if(status!==undefined && !['DRAFT','READY','GENERATED','DELIVERED','WAITING_RETURN','PARTIAL','CONFIRMED','FAILED','CANCELED'].includes(status))
    throw scopeError('申请状态无效',400,'INVALID_INPUT');
  // Pin the ordered scope index: mixed run data can make MySQL prefer a
  // relationship index and sort thousands of rows for a small cursor page.
  return {sql:`SELECT id,public_id,app_no,file_type,business_code,status,business_date,application_amount,application_volume
    FROM applications FORCE INDEX (${status===undefined?'uq_application_scope':'ix_application_list'})
    WHERE workspace_id=? AND chat_id=? AND run_id=?${status===undefined?'':' AND status=?'} AND id>? ORDER BY id LIMIT ?`,
    values:[...(status===undefined?[]:[status]),...pagination(page)]};
}
const digits = length => String(crypto.randomBytes(8).readBigUInt64BE() % (10n ** BigInt(length))).padStart(length,'0');

export function createRunStore(db, scope, lifecycle) {
  const keys = [scope.workspace_id,scope.chat_id,scope.run_id];
  const remote = [scope.ta_environment_id,scope.ta_code,scope.distributor_code];
  const guard = (write = false) => {
    if (!lifecycle.open) throw scopeError('执行上下文已关闭',409,'CLOSED_SCOPE');
    if (write && (scope.chat_status!=='ACTIVE' || !['DRAFT','ACTIVE'].includes(scope.status))) {
      throw scopeError('当前执行不允许修改模拟数据',409,'RUN_LOCKED');
    }
  };
  const rows = async (sql, params = []) => { guard(); const [result]=await db.execute(sql,[...keys,...params]); return result; };
  const customer = async publicId => {
    const result=await rows(`SELECT id,public_id FROM test_customers
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND public_id=?`,[publicId]);
    if (!result[0]) throw scopeError('客户不存在',404,'RECORD_NOT_FOUND');
    return result[0];
  };
  const reserve = async (kind, namespace, value) => db.execute(`INSERT INTO test_identifiers
    (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code,identifier_kind,namespace,identifier_value)
    VALUES (?,?,?,?,?,?,?,?,?)`,[...keys,...remote,kind,namespace,value]);

  async function createCustomer(input) {
    guard(true);const b=payload(input),name=text(b.investorName,200,'姓名');
    const type=text(b.certificateType,3,'证件类型').toUpperCase(),certificate=text(b.certificateNo,40,'证件号').toUpperCase();
    if (!/^[A-Z0-9]{1,3}$/.test(type) || !/^[A-Z0-9-]{1,40}$/.test(certificate)
      || !['0','1'].includes(b.investorType)) throw scopeError('测试身份格式无效',400,'INVALID_INPUT');
    const balance=decimal(b.simulatedBalance??'0.00'),profile=json(b.profile??{}),publicId=crypto.randomUUID();
    await reserve('CERTIFICATE',type,certificate);
    const [result]=await db.execute(`INSERT INTO test_customers
      (public_id,workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code,
       investor_name,investor_type,certificate_type,certificate_no,simulated_balance,profile_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[publicId,...keys,...remote,name,b.investorType,type,certificate,balance,profile]);
    return {id:String(result.insertId),publicId};
  }

  async function createTradingAccount(customerPublicId,input={}) {
    guard(true);const b=payload(input),c=await customer(customerPublicId);
    const account=b.transactionAccountNo??`9${digits(16)}`,branch=text(b.branchCode,9,'网点');
    if (!/^[0-9]{1,17}$/.test(account)) throw scopeError('交易账号格式无效',400,'INVALID_INPUT');
    await reserve('TRANSACTION',scope.distributor_code,account);
    const [result]=await db.execute(`INSERT INTO trading_accounts
      (workspace_id,chat_id,run_id,customer_id,ta_environment_id,ta_code,distributor_code,transaction_account_no,branch_code)
      VALUES (?,?,?,?,?,?,?,?,?)`,[...keys,c.id,...remote,account,branch]);
    return {id:String(result.insertId),transactionAccountNo:account};
  }

  async function createApplication(input) {
    guard(true);const b=payload(input);
    if (!['01','03'].includes(b.fileType) || !/^\d{3}$/.test(b.businessCode||'')) throw scopeError('申请类型无效',400,'INVALID_INPUT');
    const accountRows=await rows(`SELECT t.id,t.customer_id,t.transaction_account_no,t.branch_code,a.ta_account_no,
      c.investor_name,c.investor_type,c.certificate_type,c.certificate_no
      FROM trading_accounts t JOIN test_customers c ON c.workspace_id=t.workspace_id AND c.chat_id=t.chat_id
      AND c.run_id=t.run_id AND c.id=t.customer_id LEFT JOIN trading_account_links l ON l.workspace_id=t.workspace_id
      AND l.chat_id=t.chat_id AND l.run_id=t.run_id AND l.trading_account_id=t.id
      LEFT JOIN ta_accounts a ON a.workspace_id=l.workspace_id AND a.chat_id=l.chat_id AND a.run_id=l.run_id AND a.id=l.ta_account_id
      WHERE t.workspace_id=? AND t.chat_id=? AND t.run_id=? AND t.id=?`,[b.tradingAccountId]);
    const account=accountRows[0];if (!account) throw scopeError('交易账号不存在',404,'RECORD_NOT_FOUND');
    const date=text(b.businessDate,10,'业务日期');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date) throw scopeError('业务日期无效',400,'INVALID_INPUT');
    const mode=b.testMode??'NORMAL';if (!['NORMAL','NEGATIVE'].includes(mode)) throw scopeError('测试模式无效',400,'INVALID_INPUT');
    const amount=decimal(b.applicationAmount,{signed:mode==='NEGATIVE',nullable:true});
    const volume=decimal(b.applicationVolume,{signed:mode==='NEGATIVE',nullable:true});
    const fields=JSON.parse(json(b.fields??{})),appNo=`${date.replaceAll('-','')}${digits(16)}`,publicId=crypto.randomUUID();
    const references=await resolveProtocolReferences(db,scope,fields);
    const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
    const record={...fields,AppSheetSerialNo:appNo,DistributorCode:scope.distributor_code,
      TransactionAccountID:account.transaction_account_no,TAAccountID:b.businessCode==='001'?null:account.ta_account_no??null,
      TransactionDate:date.replaceAll('-',''),TransactionTime:time.replaceAll(':',''),BusinessCode:b.businessCode,
      BranchCode:account.branch_code,ApplicationAmount:amount,ApplicationVol:volume};
    if (b.fileType==='01') Object.assign(record,{InvestorName:account.investor_name,IndividualOrInstitution:account.investor_type,
      CertificateType:account.certificate_type,CertificateNo:account.certificate_no});
    await reserve('APPLICATION',scope.distributor_code,appNo);
    const [result]=await db.execute(`INSERT INTO applications
      (public_id,workspace_id,chat_id,run_id,customer_id,trading_account_id,ta_environment_id,ta_code,distributor_code,
       file_type,business_code,app_no,ta_account_no,fund_code,share_class,application_amount,application_volume,
       business_date,transaction_time,test_mode,record_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [publicId,...keys,account.customer_id,account.id,...remote,b.fileType,b.businessCode,appNo,record.TAAccountID,
      fields.FundCode??null,fields.ShareClass??null,amount,volume,date,time,mode,json(record)]);
    await persistProtocolReferences(db,scope,result.insertId,references);
    return {id:String(result.insertId),publicId,appNo};
  }

  async function listCustomers(page) {
    return rows(`SELECT id,public_id,investor_name,investor_type,simulated_balance FROM test_customers
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? ORDER BY id LIMIT ?`,pagination(page));
  }
  async function getCustomer(publicId) {
    const result=await rows(`SELECT id,public_id,investor_name,investor_type,certificate_type,certificate_no,
      simulated_balance,profile_json FROM test_customers WHERE workspace_id=? AND chat_id=? AND run_id=? AND public_id=?`,[publicId]);
    if (!result[0]) throw scopeError('客户不存在',404,'RECORD_NOT_FOUND');
    return result[0];
  }
  async function listApplications(page) {
    const query=applicationPageQuery(page);
    return rows(query.sql,query.values);
  }
  async function listConfirmations(page) {
    return rows(`SELECT id,application_id,return_code,error_detail,outcome,confirmed_amount,confirmed_volume,charge,confirmation_date
      FROM confirmations WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? ORDER BY id LIMIT ?`,pagination(page));
  }
  async function listPositions(page) {
    return rows(`SELECT id,trading_account_id,fund_code,share_class,branch_code,available_volume,frozen_volume,total_volume
      FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? ORDER BY id LIMIT ?`,pagination(page));
  }
  async function listFileRecords(page) {
    return rows(`SELECT id,file_id,record_index,application_id,match_status,record_json
      FROM file_records WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>? ORDER BY id LIMIT ?`,pagination(page));
  }
  return Object.freeze({createCustomer,createTradingAccount,createApplication,listCustomers,getCustomer,
    listApplications,listConfirmations,listPositions,listFileRecords});
}
