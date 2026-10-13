import crypto from 'node:crypto';
import {fileQueryFields,publicQueryFields,compileCatalogQuery,extraCatalogOptions,catalogSuggestions} from './catalog-query.js';
import {authenticateSession,storeError} from './index.js';
const scopeJoin=`LEFT JOIN case_chats c ON c.workspace_id=f.workspace_id AND c.id=f.chat_id`;
const returnJoin=`JOIN case_chats c ON c.workspace_id=f.workspace_id AND c.id=f.chat_id JOIN cases k ON k.workspace_id=f.workspace_id AND k.chat_id=f.chat_id AND k.id=f.case_id`;
const unmatchedInbound="(f.direction='OUTBOUND' OR (NOT EXISTS (SELECT 1 FROM case_return_parse_files r WHERE r.workspace_id=f.workspace_id AND r.file_name=f.file_name AND r.content_sha256=f.content_sha256) AND NOT EXISTS (SELECT 1 FROM case_holdings_return_files r WHERE r.workspace_id=f.workspace_id AND r.file_name=f.file_name AND r.content_sha256=f.content_sha256)))";
const selects=[`SELECT 'outbound' AS kind,CAST(f.id AS CHAR) AS locator,f.file_name AS fileName,f.file_type AS fileType,f.direction AS direction,f.record_count AS recordCount,OCTET_LENGTH(f.raw_bytes) AS byteLength,f.created_at AS createdAt,c.title AS project,NULL AS caseTitle,c.public_id AS chatId,NULL AS caseId,h.channel_name AS channelName FROM exchange_files f ${scopeJoin} JOIN exchange_channels h ON h.workspace_id=f.workspace_id AND h.id=f.channel_id WHERE f.workspace_id=? AND (c.id IS NOT NULL OR (f.chat_id IS NULL AND f.direction='INBOUND')) AND ${unmatchedInbound}`,
 `SELECT 'return' AS kind,CAST(f.parse_id AS CHAR) AS locator,f.file_name AS fileName,p.expected_type AS fileType,'INBOUND' AS direction,NULL AS recordCount,OCTET_LENGTH(f.raw_bytes) AS byteLength,p.created_at AS createdAt,c.title AS project,k.title AS caseTitle,c.public_id AS chatId,k.public_id AS caseId,NULL AS channelName FROM case_return_parse_files f ${returnJoin} JOIN case_return_parses p ON p.workspace_id=f.workspace_id AND p.chat_id=f.chat_id AND p.case_id=f.case_id AND p.id=f.parse_id WHERE f.workspace_id=?`,
 `SELECT 'holdings' AS kind,CAST(f.parse_id AS CHAR) AS locator,f.file_name AS fileName,'05' AS fileType,'INBOUND' AS direction,NULL AS recordCount,OCTET_LENGTH(f.raw_bytes) AS byteLength,p.created_at AS createdAt,c.title AS project,k.title AS caseTitle,c.public_id AS chatId,k.public_id AS caseId,h.channel_name AS channelName FROM case_holdings_return_files f ${returnJoin} JOIN case_holdings_return_parses p ON p.workspace_id=f.workspace_id AND p.chat_id=f.chat_id AND p.case_id=f.case_id AND p.id=f.parse_id JOIN exchange_channels h ON h.workspace_id=p.workspace_id AND h.id=p.channel_id WHERE f.workspace_id=?`];
const archivedDate=`(SELECT STR_TO_DATE(meta.fileDate,'%Y%m%d') FROM JSON_TABLE(p.parsed_json,'$.files[*]' COLUMNS (fileName VARCHAR(120) PATH '$.fileName',fileDate VARCHAR(8) PATH '$.date')) meta WHERE meta.fileName=f.file_name LIMIT 1)`;
const archivedType=`COALESCE((SELECT meta.fileType FROM JSON_TABLE(JSON_MERGE_PRESERVE(COALESCE(JSON_EXTRACT(p.parsed_json,'$.files'),JSON_ARRAY()),COALESCE(JSON_EXTRACT(p.parsed_json,'$.packageFiles'),JSON_ARRAY())),'$[*]' COLUMNS (fileName VARCHAR(120) PATH '$.fileName',fileType VARCHAR(8) PATH '$.fileType')) meta WHERE meta.fileName=f.file_name LIMIT 1),CASE WHEN f.file_name=JSON_UNQUOTE(JSON_EXTRACT(p.parsed_json,'$.index.fileName')) THEN 'OFI' ELSE p.expected_type END)`;
const fileSelects = selects.map((sql,index)=>{
  if(index===0) {
    const names=`(SELECT GROUP_CONCAT(DISTINCT k.title ORDER BY k.title SEPARATOR '、') FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id JOIN cases k ON k.workspace_id=a.workspace_id AND k.chat_id=a.chat_id AND k.id=a.case_id WHERE ba.workspace_id=f.workspace_id AND ba.chat_id=f.chat_id AND ba.batch_id=f.batch_id AND ba.file_type=f.file_type)`;
    // JSON aggregation stays correlated to the file; one batch may contain many Cases.
    const titles=`(SELECT JSON_KEYS(JSON_OBJECTAGG(k.title,1)) FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id JOIN cases k ON k.workspace_id=a.workspace_id AND k.chat_id=a.chat_id AND k.id=a.case_id WHERE ba.workspace_id=f.workspace_id AND ba.chat_id=f.chat_id AND ba.batch_id=f.batch_id AND ba.file_type=f.file_type)`;
    const caseIds=`(SELECT JSON_KEYS(JSON_OBJECTAGG(k.public_id,1)) FROM batch_applications ba JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id JOIN cases k ON k.workspace_id=a.workspace_id AND k.chat_id=a.chat_id AND k.id=a.case_id WHERE ba.workspace_id=f.workspace_id AND ba.chat_id=f.chat_id AND ba.batch_id=f.batch_id AND ba.file_type=f.file_type)`;
    return sql.replace('NULL AS caseTitle',names+' AS caseTitle').replace('FROM exchange_files f',`,COALESCE(${caseIds},JSON_ARRAY()) AS caseIds,COALESCE(${titles},JSON_ARRAY()) AS caseTitles,h.distributor_code AS distributorCode,h.ta_code AS taCode,(SELECT b.business_date FROM exchange_batches b WHERE b.workspace_id=f.workspace_id AND b.chat_id=f.chat_id AND b.id=f.batch_id) AS businessDate,(SELECT b.public_id FROM exchange_batches b WHERE b.workspace_id=f.workspace_id AND b.chat_id=f.chat_id AND b.id=f.batch_id) AS batchId FROM exchange_files f`);
  }
  const channel=index===1?`(SELECT b.channel_id FROM exchange_batches b WHERE b.workspace_id=p.workspace_id AND b.chat_id=p.chat_id AND b.id=p.batch_id)`:'p.channel_id';
  const lookup=column=>`(SELECT h.${column} FROM exchange_channels h WHERE h.workspace_id=p.workspace_id AND h.id=${channel})`;
  let enriched=sql.replace(' FROM case_',`,JSON_ARRAY(k.public_id) AS caseIds,JSON_ARRAY(k.title) AS caseTitles,${lookup('distributor_code')} AS distributorCode,${lookup('ta_code')} AS taCode,${archivedDate} AS businessDate,${index===1?`(SELECT b.public_id FROM exchange_batches b WHERE b.workspace_id=p.workspace_id AND b.chat_id=p.chat_id AND b.id=p.batch_id)`:'NULL'} AS batchId FROM case_`);
  if(index===1)enriched=enriched.replace('NULL AS channelName',lookup('channel_name')+' AS channelName').replace('p.expected_type AS fileType',archivedType+' AS fileType');
  if(index===2)enriched=enriched.replace("'05' AS fileType",archivedType.replace('p.expected_type',"'05'")+' AS fileType');
  return enriched;
});
export function fileCatalogOptions(input={}){const q=String(input.q??'').trim(),offset=Number(input.offset??0),limit=Number(input.limit??100);if(q.length>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>200)throw storeError('INVALID_CATALOG_QUERY',400,'查询条件无效');return {q,offset,limit,...extraCatalogOptions(input)};}
export function createGlobalFileCatalog({transaction}){
 return {async listFiles(token,input={}) {
   const options=fileCatalogOptions(input),{offset,limit}=options;
   const queryFields=fileQueryFields();
   const compiled=compileCatalogQuery(options,queryFields,{defaultOrder:'v.createdAt DESC,v.fileName,v.kind,v.locator',quickFields:queryFields.filter(f=>['fileName','project','caseTitle','fileType','channelName'].includes(f.key))});
   return transaction(async db=>{
     const auth=await authenticateSession(db,token);
     const values=[auth.workspace_id,auth.workspace_id,auth.workspace_id,...compiled.values];
     const base=`SELECT * FROM (${fileSelects.join(' UNION ALL ')}) v WHERE 1=1${compiled.sql}`;
     if(options.optionsField)return catalogSuggestions(db,base,values,queryFields,options.optionsField);
     const [[count]]=await db.execute(`SELECT COUNT(*) AS total FROM (${base}) counted`,values);
     const [rows]=await db.execute(`${base} ORDER BY ${compiled.order} LIMIT ${limit} OFFSET ${offset}`,values);
     return {files:rows.map(row=>({...row,caseTitle:Array.isArray(row.caseTitles)?row.caseTitles.join('、'):row.caseTitle,businessDate:row.businessDate instanceof Date?row.businessDate.toISOString().slice(0,10):row.businessDate})),queryFields:publicQueryFields(queryFields),total:Number(count.total),offset,limit};
   });
 },
 async downloadFile(token,{kind,id,fileName}){
  if(!['outbound','return','holdings'].includes(kind)||!/^\d{1,19}$/.test(String(id))||Number(id)===0||typeof fileName!=='string'||!/^[A-Za-z0-9_.-]{1,120}$/.test(fileName))throw storeError('INVALID_FILE',400,'文件标识无效');
  return transaction(async db=>{const auth=await authenticateSession(db,token);const table={outbound:'exchange_files',return:'case_return_parse_files',holdings:'case_holdings_return_files'}[kind];const [[file]]=await db.execute(`SELECT f.file_name,f.raw_bytes,f.content_sha256 FROM ${table} f ${kind==='outbound'?scopeJoin:returnJoin} WHERE f.workspace_id=? AND f.${kind==='outbound'?'id':'parse_id'}=? AND f.file_name=?${kind==='outbound'?" AND (c.id IS NOT NULL OR (f.chat_id IS NULL AND f.direction='INBOUND'))":''}`,[auth.workspace_id,String(id),fileName]);if(!file)throw storeError('FILE_NOT_FOUND',404,'文件不存在或无法访问');const bytes=Buffer.from(file.raw_bytes);if(crypto.createHash('sha256').update(bytes).digest('hex')!==file.content_sha256)throw storeError('FILE_SOURCE_INVALID',409,'原文件校验失败，请重新接收文件');return {fileName:file.file_name,rawBytes:bytes};});
 }};
}
