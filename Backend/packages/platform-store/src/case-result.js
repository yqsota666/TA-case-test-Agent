import crypto from 'node:crypto';
import {authenticateSession,storeError} from './index.js';
import {exchangeOrderContext} from './exchange-order.js';
const json=v=>typeof v==='string'?JSON.parse(v):v;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCaseResultRepository({transaction}){
 async function context(db,token,input,write=false){
  if(![input.chatPublicId,input.casePublicId].every(v=>uuid.test(v??'')))throw storeError('INVALID_INPUT',400,'Chat或Case标识无效');
  const auth=await authenticateSession(db,token);
  const [[owner]]=await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,c.status AS chat_status,k.status AS case_status
   FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
   WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=?${write?' FOR UPDATE':''}`,[auth.workspace_id,input.chatPublicId,input.casePublicId]);
  if(!owner)throw storeError('CASE_NOT_FOUND',404,'Case不存在');
  return {auth,owner,keys:[auth.workspace_id,owner.chat_id,owner.case_id]};
 }
 async function collect(db,keys,write=false){
  const lock=write?' FOR UPDATE':'';
  const [[planRow]]=await db.execute(`SELECT version_number,plan_json FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=? AND status='LOCKED' ORDER BY version_number DESC LIMIT 1${lock}`,keys);
  if(!planRow)throw storeError('PLAN_NOT_CONFIRMED',409,'须先确认Plan');
  const plan=json(planRow.plan_json),pending=[],issues=[],evidence=[];
  const [apps]=await db.execute(`SELECT CAST(a.id AS CHAR) AS id,CAST(a.channel_id AS CHAR) AS channelId,a.file_type AS fileType,a.status,a.record_json AS record,
   r.outcome,r.return_code AS returnCode,r.record_json AS confirmation,CAST(r.parse_id AS CHAR) AS parseId
   FROM applications a LEFT JOIN sales_return_confirmations r ON r.workspace_id=a.workspace_id AND r.application_id=a.id
   WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? ORDER BY a.id LIMIT 501${lock}`,keys);
  const [parses]=await db.execute(`SELECT CAST(id AS CHAR) AS id,CAST(channel_id AS CHAR) AS channelId,content_sha256,parsed_json,applied_json FROM case_holdings_return_parses
   WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id LIMIT 101${lock}`,keys);
  if(apps.length>500 || parses.length>100)issues.push('Case证据超过本次处理上限，需要人工缩小范围');
  const targets=new Map();
  const addTarget=(channel,account)=>{if(account)targets.set(channel+'|'+account,[channel,account]);};
  for(const app of apps.slice(0,500)){
   const r=json(app.record),confirmed=app.confirmation&&json(app.confirmation);addTarget(app.channelId,r.TransactionAccountID);
   if(!['CONFIRMED','FAILED'].includes(app.status))pending.push(`申请${app.id}尚未完成TA确认并同步`);
   evidence.push({id:'application:'+app.id,source:{kind:'APPLICATION_CONFIRMATION',applicationId:app.id,parseId:app.parseId,channelId:app.channelId,fileType:app.fileType,businessDate:r.TransactionDate},
    values:{status:app.status,returnCode:app.returnCode,transactionAccountId:r.TransactionAccountID,fundCode:r.FundCode??null,shareClass:r.ShareClass??null,
     confirmedAmount:confirmed?.ConfirmedAmount??null,confirmedVolume:confirmed?.ConfirmedVol??null,taAccountId:confirmed?.TAAccountID??null}});
  }
  for(const p of parses.slice(0,100))for(const f of json(p.parsed_json).files)for(const r of f.records){
   if(r.DetailFlag==='0')addTarget(p.channelId,r.TransactionAccountID);
  }
  if(targets.size>500)issues.push('账户引用超过处理上限，不能自动给出通过建议');
  const [refs]=await db.execute(`SELECT CAST(account_id AS CHAR) AS id FROM case_sales_account_refs WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY account_id LIMIT 501${lock}`,keys);
  if(refs.length>500)issues.push('账户引用超过处理上限');
  const pairs=[...targets.values()].slice(0,500),ids=refs.slice(0,500).map(r=>r.id);
  const conditions=[];const args=[keys[0]];
  if(pairs.length){conditions.push('(channel_id,transaction_account_id) IN ('+pairs.map(()=>'(?,?)').join(',')+')');args.push(...pairs.flat());}
  if(ids.length){conditions.push('id IN ('+ids.map(()=>'?').join(',')+')');args.push(...ids);}
  let accounts=[];
  if(conditions.length)[accounts]=await db.execute(`SELECT CAST(id AS CHAR) AS id,CAST(channel_id AS CHAR) AS channelId,transaction_account_id AS transactionAccountId,
   ta_account_id AS taAccountId,branch_code AS branchCode FROM sales_confirmed_accounts WHERE workspace_id=? AND (${conditions.join(' OR ')}) ORDER BY id LIMIT 501${lock}`,args);
  for(const a of accounts.slice(0,500))evidence.push({id:'account:'+a.id,source:{kind:'FORMAL_ACCOUNT',accountId:a.id,channelId:a.channelId},values:{transactionAccountId:a.transactionAccountId,taAccountId:a.taAccountId,branchCode:a.branchCode}});
  if(accounts.length>500)issues.push('正式账户超过处理上限');
  if(accounts.length){
   const [holdings]=await db.execute(`SELECT CAST(account_id AS CHAR) AS accountId,CAST(channel_id AS CHAR) AS channelId,fund_code AS fundCode,share_class AS shareClass,
    total_volume AS totalVolume,available_volume AS availableVolume,frozen_volume AS frozenVolume,DATE_FORMAT(snapshot_date,'%Y%m%d') AS snapshotDate,
    CAST(snapshot_parse_id AS CHAR) AS snapshotParseId FROM sales_confirmed_holdings WHERE workspace_id=? AND account_id IN (${accounts.slice(0,500).map(()=>'?').join(',')}) ORDER BY channel_id,account_id,fund_code,share_class LIMIT 501${lock}`,[keys[0],...accounts.slice(0,500).map(a=>a.id)]);
   if(holdings.length>500)issues.push('持仓证据超过处理上限');
   for(const h of holdings.slice(0,500))evidence.push({id:['holding',h.accountId,h.fundCode,h.shareClass].join(':'),source:{kind:'CURRENT_FORMAL_HOLDING',accountId:h.accountId,channelId:h.channelId,snapshotParseId:h.snapshotParseId},values:{...h,transactionAccountId:accounts.find(a=>a.id===h.accountId)?.transactionAccountId}});
  }
  if(!Array.isArray(plan.scenarios)||!plan.scenarios.length)issues.push('当前Plan没有可核验场景');
  try{
   const order=await exchangeOrderContext(db,keys,write);
   for(const s of order.plan.steps.filter(s=>s.required)){
    if(!order.events.some(e=>e.stepId===s.stepId && e.condition===(s.direction==='SEND'?'SENT':'PARSED')))pending.push(`步骤${s.stepId}尚未完成`);
    if(s.fileType==='05'){
     const accepted=order.events.filter(e=>e.stepId===s.stepId && e.holdingsParseId);
     if(!accepted.length || accepted.some(e=>!parses.find(p=>p.id===e.holdingsParseId)?.applied_json))pending.push(`步骤${s.stepId}的05尚未确认同步`);
    }
   }
  }catch(e){if(e.code!=='EXCHANGE_PLAN_REQUIRED')throw e;issues.push('Plan尚无已确认文件时序');}
  const [returnSources]=await db.execute(`SELECT CAST(parse_id AS CHAR) AS parseId,file_name AS fileName,content_sha256 AS expectedHash,SHA2(raw_bytes,256) AS actualHash FROM case_return_parse_files WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY parse_id,file_name LIMIT 2001${lock}`,keys);
  const [holdingSources]=await db.execute(`SELECT CAST(parse_id AS CHAR) AS parseId,file_name AS fileName,content_sha256 AS expectedHash,SHA2(raw_bytes,256) AS actualHash FROM case_holdings_return_files WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY parse_id,file_name LIMIT 2001`,keys);
  if([...returnSources,...holdingSources].some(s=>s.expectedHash!==s.actualHash))issues.push('原始TA文件摘要不一致，需要人工核查');
  const [returnPackages]=await db.execute(`SELECT CAST(id AS CHAR) AS id,content_sha256 FROM case_return_parses
   WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id LIMIT 501${lock}`,keys);
  if(returnPackages.length>500)issues.push('回传包超过处理上限');
  const incomplete=(packages,sources)=>packages.some(p=>{
   const entries=sources.filter(file=>file.parseId===p.id).map(file=>[file.fileName,file.actualHash]).sort((a,b)=>a[0].localeCompare(b[0]));
   return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')!==p.content_sha256;
  });
  if(incomplete(returnPackages,returnSources) || incomplete(parses,holdingSources))issues.push('原始TA文件包缺失或摘要不一致，需要补齐完整原文件');
  if(returnSources.length>2000 || holdingSources.length>2000)issues.push('原始证据文件超过处理上限');
  let preparedAccounts;
  if(plan.contract){
   const [draftAccounts]=await db.execute(`SELECT account_no AS transactionAccountId FROM case_generated_accounts
    WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id LIMIT 101${lock}`,keys);
   preparedAccounts=draftAccounts;
   if(draftAccounts.length!==plan.contract.dataSpecification.accounts.length)issues.push('准备账户与已确认数据定义数量不一致');
  }
  const snapshot={...(preparedAccounts?{preparedAccounts}:{}),sources:{returns:returnSources,holdings:holdingSources},planVersion:planRow.version_number,plan,evidence,pending:[...new Set(pending)],issues};
  return {...snapshot,sha256:digest(snapshot)};
 }
 async function snapshot(token,input){return transaction(async db=>{const {keys,owner}=await context(db,token,input);if(owner.chat_status!=='ACTIVE'||['PASS','FAIL'].includes(owner.case_status))throw storeError('CASE_NOT_WRITABLE',409,'Chat或Case已结束');return collect(db,keys);});}
 async function save(token,input,state){return transaction(async db=>{
  const {auth,owner,keys}=await context(db,token,input,true);
  if(owner.chat_status!=='ACTIVE'||['PASS','FAIL'].includes(owner.case_status))throw storeError('CASE_NOT_WRITABLE',409,'Chat或Case已结束');
  await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? ORDER BY id FOR UPDATE',[keys[0]]);
  const current=await collect(db,keys,true);
  if(current.sha256!==state.snapshot.sha256)throw storeError('CASE_RESULT_CHANGED',409,'模型处理期间证据已变化，请重新判断');
  const [saved]=await db.execute(`INSERT INTO case_result_reviews(workspace_id,chat_id,case_id,plan_version,evidence_sha256,evidence_json,suggestion_json,actor_user_id) VALUES (?,?,?,?,?,?,?,?)`,[...keys,current.planVersion,current.sha256,JSON.stringify(current),JSON.stringify(state.suggestion),auth.user_id]);
  return {reviewId:String(saved.insertId),phase:state.phase,snapshot:current,suggestion:state.suggestion};
 });}
 async function read(token,input){return transaction(async db=>{
  const {keys}=await context(db,token,input);
  const [[row]]=await db.execute(`SELECT CAST(id AS CHAR) AS reviewId,evidence_json,suggestion_json,final_verdict AS finalVerdict,confirmation_reason AS reason,confirmed_at AS confirmedAt FROM case_result_reviews WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id DESC LIMIT 1`,keys);
  return row?{reviewId:row.reviewId,snapshot:json(row.evidence_json),suggestion:json(row.suggestion_json),finalVerdict:row.finalVerdict,reason:row.reason,confirmedAt:row.confirmedAt}:{reviewId:null};
 });}
 async function confirm(token,input){
  if(!/^[1-9]\d{0,18}$/.test(String(input.reviewId??''))||!['PASS','FAIL'].includes(input.verdict)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw storeError('INVALID_INPUT',400,'请选择通过或不通过，并填写人工核对说明');
  return transaction(async db=>{
   const {auth,owner,keys}=await context(db,token,input,true);
   const [[row]]=await db.execute(`SELECT evidence_sha256,suggestion_json,final_verdict FROM case_result_reviews WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=? FOR UPDATE`,[...keys,input.reviewId]);
   if(!row)throw storeError('REVIEW_NOT_FOUND',404,'判断记录不存在');
   if(row.final_verdict){if(row.final_verdict!==input.verdict)throw storeError('VERDICT_CONFLICT',409,'最终结论已保存，不能覆盖');return {finalVerdict:row.final_verdict,duplicate:true};}
   if(owner.chat_status!=='ACTIVE'||['PASS','FAIL'].includes(owner.case_status))throw storeError('CASE_NOT_WRITABLE',409,'Chat或Case已结束');
   const [[latest]]=await db.execute('SELECT CAST(id AS CHAR) AS id FROM case_result_reviews WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',keys);
   if(latest.id!==String(input.reviewId))throw storeError('REVIEW_SUPERSEDED',409,'请确认最新判断版本');
   await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? ORDER BY id FOR UPDATE',[keys[0]]);
   const current=await collect(db,keys,true);
   if(current.sha256!==row.evidence_sha256)throw storeError('CASE_RESULT_CHANGED',409,'证据或Plan已变化，请重新判断');
   const suggestion=json(row.suggestion_json);
   if(['WAITING','REVIEW'].includes(suggestion.outcome))throw storeError('RESULT_NOT_READY',409,'请先补齐结果或澄清预期，不能直接封存');
   await db.execute(`UPDATE case_result_reviews SET final_verdict=?,confirmation_reason=?,confirmed_by_user_id=?,confirmed_at=CURRENT_TIMESTAMP(3) WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,[input.verdict,input.reason.trim(),auth.user_id,...keys,input.reviewId]);
   await db.execute('UPDATE cases SET status=? WHERE workspace_id=? AND chat_id=? AND id=?',[input.verdict,...keys]);
   await db.execute(`INSERT INTO case_state_events(workspace_id,chat_id,case_id,from_status,to_status,actor_user_id,reason) VALUES (?,?,?,?,?,?,?)`,[...keys,owner.case_status,input.verdict,auth.user_id,'result review '+input.reviewId+': '+input.reason.trim()]);
   return {finalVerdict:input.verdict,duplicate:false};
  });
 }
 return Object.freeze({snapshot,save,read,confirm});
}
