import crypto from 'node:crypto';
import { canonical,keysOf,reject,parse,ensureRuntime } from './store.js';
import { messageSchema,resumeSchema } from './schemas.js';
import {pendingCalls} from './context.js';

export async function insertEvent({db,scope,auth,eventKey,source,payload}) {
  const keys=keysOf(scope);
  const [[prior]]=await db.execute('SELECT public_id,payload_json FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND event_key=?',[...keys,eventKey]);
  if (prior) {
    if (canonical(prior.payload_json)!==canonical(payload)) reject('同一请求编号对应不同内容','REQUEST_CONFLICT',409);
    return {eventId:prior.public_id,duplicate:true};
  }
  const id=crypto.randomUUID();
  await db.execute(`INSERT INTO agent_events(public_id,workspace_id,chat_id,run_id,actor_user_id,event_key,source,payload_json)
    VALUES (?,?,?,?,?,?,?,?)`,[id,...keys,auth.user_id,eventKey,source,canonical(payload)]);
  return {eventId:id,duplicate:false};
}

export function createEventService(store) {
  const enqueue=(token,ids,input,{resume=false}={})=>{
    const body=parse(resume?resumeSchema:messageSchema,input);
    return store.withScope(token,ids,async({db,keys,...context})=>{
      const eventKey='request:'+body.requestId;
      const [[count]]=await db.execute(`SELECT COUNT(*) AS n FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=?
        AND created_at>UTC_TIMESTAMP(3)-INTERVAL 1 MINUTE AND source IN ('USER','RESUME') AND event_key<>?`,[...keys,eventKey]);
      if (Number(count.n)>=10) reject('Agent 请求过于频繁，请稍后重试','AGENT_RATE_LIMIT',429);
      const result=await insertEvent({...context,db,eventKey,source:resume?'RESUME':'USER',payload:resume?{content:'恢复未完成的处理，先读取真实状态。'}:{content:body.content}});
      if (resume) await db.execute("UPDATE agent_events SET status='PENDING',error_code=NULL,error_message=NULL WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='ERROR'",keys);
      else if(!result.duplicate)await supersedeFailedEvents(db,keys);
      return result;
    },{write:true});
  };

  async function onReturns({db,auth,result}) {
    for (const route of result.routes) {
      const [[scope]]=await db.execute(`SELECT r.workspace_id,r.chat_id,r.id AS run_id FROM test_runs r
        JOIN test_chats c ON c.workspace_id=r.workspace_id AND c.id=r.chat_id
        JOIN agent_runs a ON a.workspace_id=r.workspace_id AND a.chat_id=r.chat_id AND a.run_id=r.id
        WHERE r.workspace_id=? AND c.public_id=? AND r.public_id=? AND a.status<>'ARCHIVED'`,[auth.workspace_id,route.chatPublicId,route.runPublicId]);
      if (!scope) continue;
      await insertEvent({db,scope,auth,eventKey:'return:'+route.packageId,source:'RETURN',payload:{packageId:route.packageId}});
    }
    for(const p of result.packages??[]){
      const [cases]=await db.execute(`SELECT DISTINCT g.workspace_id,g.chat_id,g.run_id FROM exchange_packages p
        JOIN package_runs pr ON pr.workspace_id=p.workspace_id AND pr.channel_id=p.channel_id AND pr.package_id=p.id
        JOIN global_case_ledgers l ON l.workspace_id=pr.workspace_id AND l.chat_id=pr.chat_id AND l.run_id=pr.run_id
        JOIN global_cases g ON g.workspace_id=l.workspace_id AND g.parent_chat_id=l.chat_id
        JOIN agent_runs a ON a.workspace_id=g.workspace_id AND a.chat_id=g.chat_id AND a.run_id=g.run_id
        WHERE p.workspace_id=? AND p.public_id=? AND a.status<>'ARCHIVED'`,[auth.workspace_id,p.publicId]);
      for(const scope of cases)await insertEvent({db,scope,auth,eventKey:'return:'+p.publicId,source:'RETURN',payload:{packageId:p.publicId}});
    }
  }

  async function onDelivery({db,auth,scope,packageId}) {
    const [[runtime]]=await db.execute('SELECT status FROM agent_runs WHERE workspace_id=? AND chat_id=? AND run_id=?',keysOf(scope));
    if (runtime && runtime.status!=='ARCHIVED') await insertEvent({db,auth,scope,eventKey:'delivery:'+packageId,source:'DELIVERY',payload:{packageId}});
  }
  async function onRetry({db,auth,scope,version,reason}) {
    await ensureRuntime(db,scope);
    await insertEvent({db,auth,scope,eventKey:`case-retry:${version}`,source:'USER',payload:{
      content:`人工要求对当前 Case 的 SOP 第 ${version} 版重试。原因：${reason}。先调用 read_case_and_shared_data，读取上一轮 AI 判定、人工判断和真实回传；与用户讨论修正点，必要时统一创建新数据，再提出新版完整 SOP。不要修改旧申请或自行批准、发文。`,
    }});
    await supersedeFailedEvents(db,keysOf(scope));
  }
  return {enqueue,onReturns,onDelivery,onRetry};
}

async function supersedeFailedEvents(db,keys) {
  // A new user instruction replaces failed processing. Pair its unexecuted calls
  // without running them, so recovery cannot write an obsolete plan/action first.
  const [events]=await db.execute("SELECT id FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='ERROR'",keys);
  for(const event of events) {
    const [rows]=await db.execute('SELECT message_json FROM agent_messages WHERE workspace_id=? AND chat_id=? AND run_id=? AND event_id=? ORDER BY id',[...keys,event.id]);
    for(const call of pendingCalls(rows.map(r=>r.message_json))) {
      const message={role:'tool',content:[{type:'tool-result',toolName:call.toolName,toolCallId:call.toolCallId,
        output:{type:'json',value:{ok:false,code:'SUPERSEDED',message:'该轮失败处理已由新的用户请求替代；此调用未恢复执行，已提交的业务事实保持有效'}}}]};
      await db.execute('INSERT INTO agent_messages(workspace_id,chat_id,run_id,event_id,message_json) VALUES (?,?,?,?,?)',[...keys,event.id,canonical(message)]);
    }
    await db.execute("UPDATE agent_events SET status='DONE',error_code='SUPERSEDED',error_message='失败处理已由新的用户请求替代，原始消息与动作保留' WHERE id=?",[event.id]);
  }
}
