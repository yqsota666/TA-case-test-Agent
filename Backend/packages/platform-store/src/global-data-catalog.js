import {authenticateSession,storeError} from './index.js';
const fields={name:'客户名称',investor_type:'客户类型',simulated_balance:'模拟余额',account_no:'交易账号',branch_code:'网点代码',customer_name:'客户名称',fund_code:'基金代码',fund_name:'基金名称',share_class:'份额类别',nav:'单位净值',total_volume:'总份额',available_volume:'可用份额',frozen_volume:'冻结份额',snapshot_date:'余额日期',ta_account_id:'TA账号',certificate_type:'证件类型',certificate_no:'证件号码',channel_name:'交换通道',business_date:'业务日期',file_type:'文件类型',business_code:'业务代码',app_no:'申请编号',status:'申请状态',created_at:'生成时间'};
export {protocolColumnLabels as protocolLabels} from './protocol-column-labels.js';
import {protocolColumnLabels as protocolLabels} from './protocol-column-labels.js';
const origins=`JOIN case_chats p ON p.workspace_id=t.workspace_id AND p.id=t.chat_id JOIN cases c ON c.workspace_id=t.workspace_id AND c.chat_id=t.chat_id AND c.id=t.case_id`;
const provenance='p.public_id AS chatId,p.title AS project,c.public_id AS caseId,c.title AS caseTitle';
const draft={customers:`SELECT t.name,t.investor_type,t.simulated_balance,(SELECT a.record_json FROM applications a JOIN case_generated_accounts ac ON ac.workspace_id=a.workspace_id AND ac.chat_id=a.chat_id AND ac.case_id=a.case_id AND ac.account_no=JSON_UNQUOTE(JSON_EXTRACT(a.record_json,'$.TransactionAccountID')) WHERE a.workspace_id=t.workspace_id AND a.chat_id=t.chat_id AND a.case_id=t.case_id AND ac.customer_id=t.id AND a.file_type='01' ORDER BY a.id DESC LIMIT 1) AS record_json,${provenance} FROM case_generated_customers t ${origins}`,accounts:`SELECT t.account_no,t.branch_code,u.name AS customer_name,(SELECT a.record_json FROM applications a WHERE a.workspace_id=t.workspace_id AND a.chat_id=t.chat_id AND a.case_id=t.case_id AND a.file_type='01' AND JSON_UNQUOTE(JSON_EXTRACT(a.record_json,'$.TransactionAccountID'))=t.account_no ORDER BY a.id DESC LIMIT 1) AS record_json,${provenance} FROM case_generated_accounts t ${origins} JOIN case_generated_customers u ON u.workspace_id=t.workspace_id AND u.chat_id=t.chat_id AND u.case_id=t.case_id AND u.id=t.customer_id`,funds:`SELECT t.fund_code,t.fund_name,t.share_class,t.nav,${provenance} FROM case_generated_funds t ${origins}`,holdings:`SELECT a.account_no,u.name AS customer_name,t.fund_code,t.share_class,t.total_volume,${provenance} FROM case_generated_holdings t ${origins} JOIN case_generated_accounts a ON a.workspace_id=t.workspace_id AND a.chat_id=t.chat_id AND a.case_id=t.case_id AND a.id=t.account_id JOIN case_generated_customers u ON u.workspace_id=a.workspace_id AND u.chat_id=a.chat_id AND u.case_id=a.case_id AND u.id=a.customer_id`,applications:`SELECT t.file_type,t.business_code,t.business_date,t.app_no,t.status,t.record_json,t.created_at,${provenance} FROM applications t ${origins}`};
const formal={customers:`SELECT t.investor_name AS name,t.investor_type,t.certificate_type,t.certificate_no,h.channel_name,a.record_json,p.title AS project,c.title AS caseTitle,p.public_id AS chatId,c.public_id AS caseId FROM sales_confirmed_accounts t JOIN exchange_channels h ON h.workspace_id=t.workspace_id AND h.id=t.channel_id JOIN sales_return_confirmations r ON r.workspace_id=t.workspace_id AND r.id=t.source_confirmation_id JOIN applications a ON a.workspace_id=r.workspace_id AND a.id=r.application_id JOIN case_chats p ON p.workspace_id=r.workspace_id AND p.id=r.chat_id JOIN cases c ON c.workspace_id=r.workspace_id AND c.chat_id=r.chat_id AND c.id=r.case_id`,accounts:`SELECT t.transaction_account_id AS account_no,t.ta_account_id,t.investor_name AS customer_name,t.branch_code,t.certificate_type,t.certificate_no,h.channel_name,a.record_json,p.title AS project,c.title AS caseTitle,p.public_id AS chatId,c.public_id AS caseId FROM sales_confirmed_accounts t JOIN exchange_channels h ON h.workspace_id=t.workspace_id AND h.id=t.channel_id JOIN sales_return_confirmations r ON r.workspace_id=t.workspace_id AND r.id=t.source_confirmation_id JOIN applications a ON a.workspace_id=r.workspace_id AND a.id=r.application_id JOIN case_chats p ON p.workspace_id=r.workspace_id AND p.id=r.chat_id JOIN cases c ON c.workspace_id=r.workspace_id AND c.chat_id=r.chat_id AND c.id=r.case_id`,funds:draft.funds,holdings:`SELECT a.transaction_account_id AS account_no,a.investor_name AS customer_name,t.fund_code,t.share_class,t.total_volume,t.available_volume,t.frozen_volume,t.snapshot_date,h.channel_name FROM sales_confirmed_holdings t JOIN sales_confirmed_accounts a ON a.workspace_id=t.workspace_id AND a.channel_id=t.channel_id AND a.id=t.account_id JOIN exchange_channels h ON h.workspace_id=t.workspace_id AND h.id=t.channel_id`,applications:draft.applications};
export function catalogOptions(input={}){
 const table=input.table??'customers',source=input.source??'draft',q=String(input.q??'').trim();
 const offset=Number(input.offset??0),limit=Number(input.limit??100);
 if(!Object.hasOwn(draft,table)||!['draft','formal'].includes(source)||q.length>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>200)throw storeError('INVALID_CATALOG_QUERY',400,'查询条件无效');
 return {table,source,q,offset,limit};
}
export function catalogProjectionColumns(query){
 const parts=[];let depth=0,quote=null,start=query.toUpperCase().indexOf('SELECT')+6;
 for(let i=start;i<query.length;i++){
  const char=query[i];
  if(quote){if(char==='\\'){i++;continue;}if(char===quote){if(query[i+1]===quote)i++;else quote=null;}continue;}
  if(char==="'"||char==='"'||char==='`'){quote=char;continue;}
  if(char==='(')depth++;else if(char===')')depth--;
  else if(depth===0&&char===','){parts.push(query.slice(start,i));start=i+1;}
  else if(depth===0&&/^\sFROM\s/i.test(query.slice(i))){parts.push(query.slice(start,i));break;}
 }
 return new Set(parts.map(part=>/\sAS\s+([a-z_]+)\s*$/i.exec(part)?.[1]??/^\s*\w+\.([a-z_]+)\s*$/i.exec(part)?.[1]).filter(Boolean));
}
export function createGlobalDataCatalog({transaction}){
 return {async listTable(token,input){const {table,source,q,offset,limit}=catalogOptions(input);return transaction(async db=>{
  const auth=await authenticateSession(db,token);
  // The fixed projection is searched as text, retaining field-specific decimals and NULLs in the result.
  const base=`${(source==='formal'?formal:draft)[table]} WHERE t.workspace_id=?`;
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const projected=catalogProjectionColumns(base);
  const searchable=Object.keys(fields).filter(k=>projected.has(k));
  const filter=q?` AND (${searchable.map(k=>`CAST(v.\`${k}\` AS CHAR) LIKE ?`).join(' OR ')}${base.includes('caseTitle')?' OR v.project LIKE ? OR v.caseTitle LIKE ?':''}${base.includes('record_json')?' OR CAST(v.record_json AS CHAR) LIKE ?':''})`:'';
  const searchValues=q?[...searchable.map(()=>pattern),...(base.includes('caseTitle')?[pattern,pattern]:[]),...(base.includes('record_json')?[pattern]:[])]:[];
  const query=`SELECT * FROM (${base}) v WHERE 1=1${filter}`;
  const [[count]]=await db.execute(`SELECT COUNT(*) AS total FROM (${query}) counted`,[auth.workspace_id,...searchValues]);
  const [rows]=await db.execute(`${query} ORDER BY ${base.includes('caseTitle')?'project,caseTitle':'account_no' in fields&&table==='holdings'?'account_no,fund_code':'1'} LIMIT ${limit} OFFSET ${offset}`,[auth.workspace_id,...searchValues]);
  const records=rows.map(({record_json,...row})=>({...row,...(record_json?(typeof record_json==='string'?JSON.parse(record_json):record_json):{})}));
  const rawKeys=new Set(records.flatMap(Object.keys));
  const aliases={name:'InvestorName',customer_name:'InvestorName',investor_type:'IndividualOrInstitution',account_no:'TransactionAccountID',branch_code:'BranchCode',certificate_type:'CertificateType',certificate_no:'CertificateNo',app_no:'AppSheetSerialNo',business_code:'BusinessCode',business_date:'TransactionDate',ta_account_id:'TAAccountID'};
  for(const row of records)for(const [local,protocol] of Object.entries(aliases)){
    if(rawKeys.has(protocol)&&(row[protocol]===undefined||row[protocol]===null||row[protocol]==='')&&row[local]!==undefined&&row[local]!==null)row[protocol]=row[local];
  }
  const keys=[...rawKeys].filter(k=>!['chatId','caseId'].includes(k)&&!(aliases[k]&&rawKeys.has(aliases[k])));
  const columns=keys.map(key=>({key,label:fields[key]??protocolLabels[key]??({project:'项目',caseTitle:'Case'}[key])??'其他协议字段'}));
  return {table,source,rows:records,columns,total:Number(count.total),offset,limit};
 });}};
}
