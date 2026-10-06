import crypto from 'node:crypto';
import {authenticateSession,storeError} from './index.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,message,status=409)=>{throw storeError(code,status,message);};
function identifier(value){if(typeof value!=='string'||!uuid.test(value))fail('INVALID_ID','Chat、Case或请求标识无效',400);}
function reasonText(value){if(typeof value!=='string'||!value.trim()||value.length>2000)fail('INVALID_REASON','请填写1–2000字说明',400);return value.trim();}
export function createChatLifecycleRepository({transaction}){
 async function context(db,token,input,write=false){
  identifier(input.chatPublicId);
  const auth=await authenticateSession(db,token);
  const [[chat]]=await db.execute(`SELECT id,public_id,title,status,close_reason,closed_at FROM case_chats WHERE workspace_id=? AND public_id=?${write?' FOR UPDATE':''}`,[auth.workspace_id,input.chatPublicId]);
  if(!chat)fail('CHAT_NOT_FOUND','Chat不存在',404);
  return {auth,chat,keys:[auth.workspace_id,chat.id]};
 }
 async function cases(db,keys,write=false){
  const [rows]=await db.execute(`SELECT k.id,k.public_id,k.title,k.status,k.predecessor_case_id,
   (SELECT r.final_verdict FROM case_result_reviews r WHERE r.workspace_id=k.workspace_id AND r.chat_id=k.chat_id AND r.case_id=k.id AND r.final_verdict IS NOT NULL ORDER BY r.id DESC LIMIT 1${write?' FOR UPDATE':''}) AS final_verdict
   FROM cases k WHERE k.workspace_id=? AND k.chat_id=? ORDER BY k.id${write?' FOR UPDATE':''}`,keys);
  return rows;
 }
 async function read(token,input){return transaction(async db=>{
  const {chat,keys}=await context(db,token,input);
  const rows=await cases(db,keys);
  const [events]=await db.execute('SELECT from_status,to_status,reason,created_at FROM chat_state_events WHERE workspace_id=? AND chat_id=? ORDER BY id',keys);
  const [links]=await db.execute(`SELECT l.kind,l.reason,s.public_id AS sourceChatPublicId,k.public_id AS sourceCasePublicId,t.public_id AS targetChatPublicId,n.public_id AS targetCasePublicId,l.created_at
   FROM chat_run_links l JOIN case_chats s ON s.workspace_id=l.workspace_id AND s.id=l.source_chat_id
   JOIN case_chats t ON t.workspace_id=l.workspace_id AND t.id=l.target_chat_id
   LEFT JOIN cases k ON k.workspace_id=l.workspace_id AND k.chat_id=l.source_chat_id AND k.id=l.source_case_id
   LEFT JOIN cases n ON n.workspace_id=l.workspace_id AND n.chat_id=l.target_chat_id AND n.id=l.target_case_id
   WHERE l.workspace_id=? AND (l.source_chat_id=? OR l.target_chat_id=?) ORDER BY l.id`,[...keys,chat.id]);
  const completed=rows.length>0 && rows.every(r=>r.final_verdict===r.status && (r.status==='PASS' || (r.status==='FAIL' && rows.some(n=>n.predecessor_case_id===r.id))));
  return {chat:{publicId:chat.public_id,title:chat.title,status:chat.status,closeReason:chat.close_reason,closedAt:chat.closed_at},cases:rows.map(r=>({publicId:r.public_id,title:r.title,status:r.status,finalVerdict:r.final_verdict,predecessorCasePublicId:rows.find(p=>p.id===r.predecessor_case_id)?.public_id??null})),canClose:chat.status==='ACTIVE'&&completed,events,links};
 });}
 async function close(token,input){
  if(!['NORMAL','FORCE'].includes(input.mode))fail('INVALID_INPUT','请选择正常或强制结束',400);
  const reason=input.mode==='FORCE'?reasonText(input.reason):null;
  if(input.mode==='NORMAL'&&input.reason!==undefined)fail('INVALID_INPUT','正常结束不接受强制原因',400);
  return transaction(async db=>{
   const {auth,chat,keys}=await context(db,token,input,true);
   const target=input.mode==='FORCE'?'FORCE_CLOSED':'CLOSED';
   if(chat.status!=='ACTIVE'){
    if(chat.status!==target||chat.close_reason!==reason)fail('CHAT_CLOSURE_CONFLICT','Chat已按另一方式结束');
    return {status:target,duplicate:true};
   }
   const rows=await cases(db,keys,true);
   if(input.mode==='NORMAL'&&(!rows.length||rows.some(r=>r.final_verdict!==r.status || !(r.status==='PASS' || (r.status==='FAIL' && rows.some(n=>n.predecessor_case_id===r.id))))))fail('CHAT_CASES_INCOMPLETE','所有Case须人工确认，失败Case的关联后续链须最终通过；否则请强制结束');
   await db.execute('UPDATE case_chats SET status=?,close_reason=?,closed_at=UTC_TIMESTAMP(3) WHERE workspace_id=? AND id=?',[target,reason,...keys]);
   await db.execute(`INSERT INTO chat_state_events(workspace_id,chat_id,from_status,to_status,actor_user_id,reason) VALUES (?,?,'ACTIVE',?,?,?)`,[...keys,target,auth.user_id,reason]);
   return {status:target,duplicate:false};
  });
 }
 async function startRun(token,input,kind){
  identifier(input.requestId);const requestId=input.requestId.toLowerCase(),reason=reasonText(input.reason);
  if(kind==='RETEST')identifier(input.casePublicId);
  const sourceId=input.casePublicId?.toLowerCase()??null;
  if(kind==='NEW_RUN'&&input.confirmPreserveFormalData!==true)fail('PRESERVATION_CONFIRMATION_REQUIRED','新轮次保留正式数据及历史，请显式确认',400);
  return transaction(async db=>{
   const {auth,chat,keys}=await context(db,token,input,true);
   const [[prior]]=await db.execute(`SELECT l.kind,l.reason,k.public_id AS source_case_public_id,t.public_id AS chatPublicId,n.public_id AS casePublicId
    FROM chat_run_links l JOIN case_chats t ON t.workspace_id=l.workspace_id AND t.id=l.target_chat_id
    LEFT JOIN cases k ON k.workspace_id=l.workspace_id AND k.chat_id=l.source_chat_id AND k.id=l.source_case_id
    LEFT JOIN cases n ON n.workspace_id=l.workspace_id AND n.chat_id=l.target_chat_id AND n.id=l.target_case_id
    WHERE l.workspace_id=? AND l.source_chat_id=? AND LOWER(l.request_id)=? ORDER BY l.id LIMIT 1 FOR UPDATE`,[...keys,requestId]);
   if(prior){if(prior.kind!==kind||prior.reason!==reason||(prior.source_case_public_id??null)!==sourceId)fail('RUN_REQUEST_CONFLICT','同一请求标识已用于其他操作');return {chatPublicId:prior.chatPublicId,casePublicId:prior.casePublicId,duplicate:true,formalDataPreserved:true};}
   const rows=await cases(db,keys,true);
   let source=null;
   if(kind==='RETEST'){
    source=rows.find(r=>r.public_id===sourceId);
    if(!source)fail('CASE_NOT_FOUND','来源Case不存在',404);
    if(source.status!=='FAIL'||source.final_verdict!=='FAIL')fail('RETEST_REQUIRES_FAIL','仅人工最终失败的Case可创建关联复测');
    if(chat.status!=='ACTIVE')fail('CHAT_CLOSED','Chat已结束，不能追加后续Case');
    if(rows.some(r=>r.predecessor_case_id===source.id))fail('RETEST_ALREADY_EXISTS','来源Case已有直接后续，请继续现有后续Case');
   }else if(chat.status==='ACTIVE')fail('CHAT_NOT_CLOSED','请先结束旧Chat，再开启空白新轮次');
   const publicId=source?chat.public_id:crypto.randomUUID();
   let nextId=chat.id;
   if(!source){
    const [next]=await db.execute('INSERT INTO case_chats(public_id,workspace_id,title) VALUES (?,?,?)',[publicId,auth.workspace_id,('新轮次：'+chat.title).slice(0,160)]);nextId=next.insertId;
    await db.execute(`INSERT INTO chat_state_events(workspace_id,chat_id,to_status,actor_user_id,reason) VALUES (?,?,'ACTIVE',?,?)`,[auth.workspace_id,nextId,auth.user_id,kind+': '+reason]);
   }
   let targetCase=null,targetId=null;
   if(source){
    targetCase=crypto.randomUUID();
    const [added]=await db.execute('INSERT INTO cases(public_id,workspace_id,chat_id,title,predecessor_case_id) VALUES (?,?,?,?,?)',[targetCase,auth.workspace_id,nextId,source.title,source.id]);targetId=added.insertId;
    await db.execute(`INSERT INTO case_state_events(workspace_id,chat_id,case_id,to_status,actor_user_id,reason) VALUES (?,?,?,'DISCUSSING',?,?)`,[auth.workspace_id,nextId,targetId,auth.user_id,'RETEST: '+reason]);
   }
   await db.execute(`INSERT INTO chat_run_links(workspace_id,source_chat_id,source_case_id,target_chat_id,target_case_id,request_id,kind,reason,actor_user_id) VALUES (?,?,?,?,?,?,?,?,?)`,[...keys,source?.id??null,nextId,targetId,requestId,kind,reason,auth.user_id]);
   return {chatPublicId:publicId,casePublicId:targetCase,duplicate:false,formalDataPreserved:true};
  });
 }
 return Object.freeze({read,close,retest:(token,input)=>startRun(token,input,'RETEST'),newRun:(token,input)=>startRun(token,input,'NEW_RUN')});
}
