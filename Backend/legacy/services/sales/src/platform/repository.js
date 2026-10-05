import crypto from 'node:crypto';
import { authenticateSession, resolveRun, mapDatabaseError, scopeError } from './scope.js';
import { createRunStore } from './run-store.js';

// The backend passes its HttpOnly session token, never a client-provided owner/workspace id.
// Raw connections and free-form SQL are deliberately not exposed through this repository.
export function createPlatformRepository({ transaction }) {
  async function withRunSession(token, ids, action) {
    const lifecycle={open:true};
    try {
      return await transaction(async db => {
        const auth=await authenticateSession(db,token),scope=await resolveRun(db,auth,ids);
        const store=createRunStore(db,scope,lifecycle);
        return action(store);
      });
    } catch(error) { throw mapDatabaseError(error); }
    finally { lifecycle.open=false; }
  }

  async function createChatWithRunSession(token, { title, channelId, businessDate }) {
    try {
      return await transaction(async db => {
        const auth=await authenticateSession(db,token);
        return createChatInWorkspace(db,auth,{title,channelId,businessDate});
      });
    } catch(error) { throw mapDatabaseError(error); }
  }
  return Object.freeze({withRunSession,createChatWithRunSession});
}

// Internal helper: authenticated workspace is supplied only by backend code.
export async function createChatInWorkspace(db,auth,{title,channelId,businessDate}){
    if (typeof title!=='string' || !title.trim() || title.trim().length>160
      || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate||'') || !/^\d{1,20}$/.test(String(channelId))
      || !Number.isFinite(Date.parse(`${businessDate}T00:00:00Z`))
      || new Date(`${businessDate}T00:00:00Z`).toISOString().slice(0,10)!==businessDate) {
      throw scopeError('chat 参数无效',400,'INVALID_INPUT');
    }
        const [[channel]]=await db.execute(`SELECT id,ta_environment_id,ta_code,distributor_code FROM exchange_channels
          WHERE workspace_id=? AND id=?`,[auth.workspace_id,channelId]);
        if (!channel) throw scopeError('交换通道不存在',404,'RECORD_NOT_FOUND');
        const chatPublicId=crypto.randomUUID(),runPublicId=crypto.randomUUID();
        const [chat]=await db.execute('INSERT INTO test_chats(public_id,workspace_id,title) VALUES (?,?,?)',
          [chatPublicId,auth.workspace_id,title.trim()]);
        await db.execute(`INSERT INTO test_runs(public_id,workspace_id,chat_id,channel_id,ta_environment_id,
          ta_code,distributor_code,run_number,business_date) VALUES (?,?,?,?,?,?,?,1,?)`,
        [runPublicId,auth.workspace_id,chat.insertId,channel.id,channel.ta_environment_id,channel.ta_code,channel.distributor_code,businessDate]);
        return {chatPublicId,runPublicId};
}
