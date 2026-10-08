import {randomUUID} from 'node:crypto';
import {authenticateSession, storeError, requiredUuid} from './index.js';

export function createAdmissionRepository({transaction}) {
  async function scoped(db, token, chatPublicId, casePublicId) {
    chatPublicId=requiredUuid(chatPublicId,'Chat'); casePublicId=requiredUuid(casePublicId,'Case');
    const auth = await authenticateSession(db, token);
    const [[row]] = await db.execute(`SELECT k.id,k.chat_id,k.title,k.status,c.title AS project_title,c.status AS project_status
      FROM cases k JOIN case_chats c ON c.workspace_id=k.workspace_id AND c.id=k.chat_id
      WHERE k.workspace_id=? AND c.public_id=? AND k.public_id=?`,[auth.workspace_id,chatPublicId,casePublicId]);
    if (!row) throw storeError('CASE_NOT_FOUND',404,'Case 不存在');
    if(row.project_status!=='ACTIVE' || ['PASS','FAIL'].includes(row.status)) throw storeError('CASE_NOT_WRITABLE',409,'当前 Case 已结束，不能继续修改');
    return {row, keys:[auth.workspace_id,row.chat_id,row.id]};
  }
  return {
    context:(token,chat,caseId)=>transaction(async db=>{
      const {row,keys}=await scoped(db,token,chat,caseId);
      const [[plan]]=await db.execute(`SELECT version_number,status,plan_json FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY version_number DESC LIMIT 1`,keys);
      const [turns]=await db.execute(`SELECT turn_number,user_text FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND status='COMPLETE' ORDER BY turn_number DESC LIMIT 6`,keys);
      const proposal=plan?(typeof plan.plan_json==='string'?JSON.parse(plan.plan_json):plan.plan_json):null;
      return {project:row.project_title,case:row.title,status:row.status,
        planVersion:plan?.version_number??null,planStatus:plan?.status??null,
        objective:proposal?.objective??proposal?.title??null,
        plan:proposal?JSON.stringify(proposal).slice(0,16000):null,
        recentRequirements:turns.reverse().map(t=>({revision:t.turn_number,text:t.user_text.slice(0,4000)}))};
    }),
    claim:(token,chat,caseId,hash)=>transaction(async db=>{
      const {keys}=await scoped(db,token,chat,caseId),lease=randomUUID();
      await db.execute(`INSERT INTO case_business_admissions
        (workspace_id,chat_id,case_id,input_hash,lease,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 120 SECOND)) ON DUPLICATE KEY UPDATE input_hash=input_hash`,[...keys,hash,lease]);
      const [[row]]=await db.execute(`SELECT lease,decision,expires_at>NOW(3) AS active FROM case_business_admissions
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND input_hash=? FOR UPDATE`,[...keys,hash]);
      if(row.decision)return {result:{decision:row.decision}};
      if(row.lease!==lease && row.active)throw storeError('ADMISSION_IN_PROGRESS',409,'同一份内容正在审核，请稍后重试');
      if(row.lease!==lease)await db.execute(`UPDATE case_business_admissions SET lease=?,expires_at=DATE_ADD(NOW(3),INTERVAL 120 SECOND)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND input_hash=?`,[lease,...keys,hash]);
      return {lease};
    }),
    finish:(token,chat,caseId,hash,lease,result)=>transaction(async db=>{
      const {keys}=await scoped(db,token,chat,caseId);
      const [update]=await db.execute(`UPDATE case_business_admissions SET decision=?
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND input_hash=? AND lease=? AND decision IS NULL`,[result.decision,...keys,hash,lease]);
      if(update.affectedRows!==1)throw storeError('ADMISSION_STALE',409,'审核状态已更新，请重试');
    }),
    release:(token,chat,caseId,hash,lease)=>transaction(async db=>{
      const {keys}=await scoped(db,token,chat,caseId);
      await db.execute(`DELETE FROM case_business_admissions WHERE workspace_id=? AND chat_id=? AND case_id=? AND input_hash=? AND lease=? AND decision IS NULL`,[...keys,hash,lease]);
    }),
  };
}
