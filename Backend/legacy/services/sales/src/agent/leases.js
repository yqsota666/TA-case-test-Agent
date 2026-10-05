import crypto from 'node:crypto';
import { keysOf,reject } from './store.js';
import {compactContext} from './context.js';

const LEASE_SECONDS=180;
export function createLeaseService({transaction}) {
  async function claim(ids) {
    return transaction(async db=>{
      const params=[],filter=ids?' AND c.public_id=? AND r.public_id=?':'';
      if(ids) params.push(ids.chatPublicId,ids.runPublicId);
      const [[event]]=await db.execute(`SELECT e.*,c.public_id AS chatPublicId,r.public_id AS runPublicId FROM agent_events e
        JOIN agent_runs a ON a.workspace_id=e.workspace_id AND a.chat_id=e.chat_id AND a.run_id=e.run_id
        JOIN test_runs r ON r.workspace_id=e.workspace_id AND r.chat_id=e.chat_id AND r.id=e.run_id
        JOIN test_chats c ON c.workspace_id=r.workspace_id AND c.id=r.chat_id
        LEFT JOIN global_case_ledgers direct_chat ON direct_chat.workspace_id=e.workspace_id AND direct_chat.chat_id=e.chat_id
        LEFT JOIN global_cases g ON g.workspace_id=e.workspace_id AND g.chat_id=e.chat_id AND g.run_id=e.run_id
        LEFT JOIN global_case_ledgers parent_chat ON parent_chat.workspace_id=g.workspace_id AND parent_chat.chat_id=g.parent_chat_id
        WHERE e.status IN ('PENDING','PROCESSING') AND (a.status<>'ARCHIVED' OR e.status='PROCESSING')
        AND COALESCE(direct_chat.ended_at,parent_chat.ended_at) IS NULL
        AND (COALESCE(direct_chat.chat_id,parent_chat.chat_id) IS NULL OR
          COALESCE(direct_chat.chat_id,parent_chat.chat_id)=(SELECT MIN(open_chat.chat_id)
            FROM global_case_ledgers open_chat WHERE open_chat.workspace_id=e.workspace_id AND open_chat.ended_at IS NULL))
        AND (a.lease_until IS NULL OR a.lease_until<=UTC_TIMESTAMP(3))${filter}
        ORDER BY e.id LIMIT 1`,params);
      if(!event) return null;
      const leaseToken=crypto.randomUUID(),keys=keysOf(event);
      // Only runtime -> event locks here. Business writes use TA -> run -> runtime;
      // locking business rows in the candidate JOIN would reverse that order.
      const [[available]]=await db.execute(`SELECT run_id FROM agent_runs WHERE workspace_id=? AND chat_id=? AND run_id=?
        AND (status<>'ARCHIVED' OR ?='PROCESSING') AND (lease_until IS NULL OR lease_until<=UTC_TIMESTAMP(3)) FOR UPDATE SKIP LOCKED`,[...keys,event.status]);
      if(!available)return null;
      const [[pending]]=await db.execute("SELECT status FROM agent_events WHERE id=? FOR UPDATE",[event.id]);
      if(!['PENDING','PROCESSING'].includes(pending?.status))return null;
      await db.execute(`UPDATE agent_runs SET lease_token=?,lease_until=UTC_TIMESTAMP(3)+INTERVAL ${LEASE_SECONDS} SECOND,status=IF(status='ARCHIVED',status,'RUNNING')
        WHERE workspace_id=? AND chat_id=? AND run_id=?`,[leaseToken,...keys]);
      await db.execute("UPDATE agent_events SET status='PROCESSING',attempts=attempts+1 WHERE id=?",[event.id]);
      if(['RETURN','DELIVERY'].includes(event.source))await coalesceCommittedEvents(db,event);
      return {...event,leaseToken};
    });
  }
  async function renew(event) {
    return transaction(async db=>{
      const [result]=await db.execute(`UPDATE agent_runs SET lease_until=UTC_TIMESTAMP(3)+INTERVAL ${LEASE_SECONDS} SECOND
        WHERE workspace_id=? AND chat_id=? AND run_id=? AND lease_token=? AND lease_until>UTC_TIMESTAMP(3)`,[...keysOf(event),event.leaseToken]);
      if (!result.affectedRows) reject('执行租约已失效','LEASE_LOST',409);
    });
  }
  async function append(event,messages) {
    return transaction(async db=>{
      await assertLease(db,event);
      for(const message of messages) await db.execute(`INSERT INTO agent_messages(workspace_id,chat_id,run_id,event_id,message_json)
        VALUES (?,?,?,?,?)`,[...keysOf(event),event.id,JSON.stringify(message)]);
    });
  }
  async function history(event,{forModel=false}={}) {
    return transaction(async db=>{
      await assertLease(db,event);
      const [rows]=await db.execute(`SELECT m.event_id,m.message_json,e.source AS event_source FROM agent_messages m
        JOIN agent_events e ON e.workspace_id=m.workspace_id AND e.chat_id=m.chat_id AND e.run_id=m.run_id AND e.id=m.event_id
        WHERE m.workspace_id=? AND m.chat_id=? AND m.run_id=? AND m.event_id<=? ORDER BY m.id LIMIT 1000`,[...keysOf(event),event.id]);
      if(rows.length===1000) reject('会话达到当前上下文上限，请整理场景后重跑','CONTEXT_LIMIT',409);
      return forModel?compactContext(rows):rows.map(r=>r.message_json);
    });
  }
  async function finish(event,error,metrics) {
    return transaction(async db=>{
      await assertLease(db,event);
      await db.execute('UPDATE agent_events SET status=?,error_code=?,error_message=?,metrics_json=? WHERE id=?',
        [error?'ERROR':'DONE',error?.code??null,error?.message??null,metrics?JSON.stringify(metrics):null,event.id]);
      await db.execute(`UPDATE agent_runs SET status=CASE WHEN status='ARCHIVED' THEN status WHEN ? THEN 'ERROR'
        WHEN JSON_UNQUOTE(JSON_EXTRACT(wait_json,'$.category'))='REVIEW' THEN 'REVIEW'
        WHEN wait_json IS NOT NULL THEN 'WAITING' ELSE 'IDLE' END,lease_token=NULL,lease_until=NULL
        WHERE workspace_id=? AND chat_id=? AND run_id=? AND lease_token=?`,[!!error,...keysOf(event),event.leaseToken]);
    });
  }
  return {claim,renew,append,history,finish};
}

async function assertLease(db,event) {
  const [[row]]=await db.execute(`SELECT lease_token,lease_until>UTC_TIMESTAMP(3) AS valid FROM agent_runs
    WHERE workspace_id=? AND chat_id=? AND run_id=? FOR UPDATE`,keysOf(event));
  if(!row?.valid || row.lease_token!==event.leaseToken) reject('执行租约已失效','LEASE_LOST',409);
}

async function coalesceCommittedEvents(db,event) {
  const keys=keysOf(event);
  const [[nextUser]]=await db.execute(`SELECT MIN(id) AS id FROM agent_events WHERE workspace_id=? AND chat_id=? AND run_id=?
    AND id>? AND status='PENDING' AND source IN ('USER','RESUME')`,[...keys,event.id]);
  // These events are already committed; the next state query sees all their facts.
  // Events arriving after this transaction stay pending and wake a later turn.
  await db.execute(`UPDATE agent_events SET status='DONE',metrics_json=? WHERE workspace_id=? AND chat_id=? AND run_id=?
    AND id>? AND id<? AND status='PENDING' AND source IN ('RETURN','DELIVERY')`,
    [JSON.stringify({coalescedInto:event.public_id}),...keys,event.id,nextUser.id??'18446744073709551615']);
}
