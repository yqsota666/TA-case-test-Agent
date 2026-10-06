import {authenticateSession,storeError} from './index.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function assertTaAccountActive(db,workspaceId,channelId,accountId){
 const [[row]]=await db.execute('SELECT CAST(COALESCE(MAX(account_id_cutoff),0) AS CHAR) AS cutoff FROM ta_reset_events WHERE workspace_id=? AND channel_id=?',[workspaceId,channelId]);
 if(BigInt(accountId)<=BigInt(row.cutoff))throw storeError('TA_ACCOUNT_RESET',409,'TA已确认重置；旧账户绑定失效，请用新01/02重新开户');
}
export function createTaResetRepository({transaction}){
 function channelId(input){if(!/^[1-9]\d{0,18}$/.test(String(input.channelId??'')))throw storeError('INVALID_INPUT',400,'通道标识无效');}
 async function read(token,input){channelId(input);return transaction(async db=>{
  const auth=await authenticateSession(db,token);
  const [[channel]]=await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? AND id=?',[auth.workspace_id,input.channelId]);
  if(!channel)throw storeError('CHANNEL_NOT_FOUND',404,'通道不存在');
  const [events]=await db.execute('SELECT epoch,CAST(account_id_cutoff AS CHAR) AS accountIdCutoff,reason,created_at FROM ta_reset_events WHERE workspace_id=? AND channel_id=? ORDER BY epoch',[auth.workspace_id,input.channelId]);
  return {channelId:String(input.channelId),epoch:events.at(-1)?.epoch??0,events,physicalResetPerformedByPlatform:false};
 });}
 async function confirm(token,input){
  channelId(input);
  if(input.confirmation!=='TA_RESET_CONFIRMED'||typeof input.requestId!=='string'||!uuid.test(input.requestId)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw storeError('INVALID_INPUT',400,'请明确确认真实TA已经重置，并填写原因与请求标识');
  return transaction(async db=>{
   const auth=await authenticateSession(db,token);
   const [chats]=await db.execute('SELECT id,status FROM case_chats WHERE workspace_id=? ORDER BY id FOR UPDATE',[auth.workspace_id]);
   const [[channel]]=await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? AND id=? FOR UPDATE',[auth.workspace_id,input.channelId]);
   if(!channel)throw storeError('CHANNEL_NOT_FOUND',404,'通道不存在');
   const [[prior]]=await db.execute('SELECT epoch,reason FROM ta_reset_events WHERE workspace_id=? AND channel_id=? AND request_id=? FOR UPDATE',[auth.workspace_id,input.channelId,input.requestId]);
   if(prior){if(prior.reason!==input.reason.trim())throw storeError('TA_RESET_REQUEST_CONFLICT',409,'同一请求标识的重置说明不同');return {epoch:prior.epoch,duplicate:true,formalHistoryPreserved:true,physicalResetPerformedByPlatform:false};}
   if(chats.some(c=>c.status==='ACTIVE'))throw storeError('TA_RESET_ACTIVE_CHATS',409,'先封存当前Workspace全部Chat，再确认TA重置');
   const [[last]]=await db.execute('SELECT COALESCE(MAX(epoch),0) AS epoch FROM ta_reset_events WHERE workspace_id=? AND channel_id=? FOR UPDATE',[auth.workspace_id,input.channelId]);
   const [[account]]=await db.execute('SELECT CAST(COALESCE(MAX(id),0) AS CHAR) AS cutoff FROM sales_confirmed_accounts WHERE workspace_id=? AND channel_id=? FOR UPDATE',[auth.workspace_id,input.channelId]);
   const epoch=Number(last.epoch)+1;
   await db.execute('INSERT INTO ta_reset_events(workspace_id,channel_id,epoch,account_id_cutoff,request_id,reason,actor_user_id) VALUES (?,?,?,?,?,?,?)',[auth.workspace_id,input.channelId,epoch,account.cutoff,input.requestId,input.reason.trim(),auth.user_id]);
   return {epoch,duplicate:false,formalHistoryPreserved:true,physicalResetPerformedByPlatform:false};
  });
 }
 return Object.freeze({read,confirm});
}
