import {authenticateSession,storeError} from './index.js';
import {exchangeOrderContext} from './exchange-order.js';

export async function readOperationFacts(db,token,{chatPublicId,casePublicId},write=false) {
  const auth=await authenticateSession(db,token);
  const [[owner]]=await db.execute(`SELECT k.id AS case_id,k.chat_id FROM cases k JOIN case_chats c
    ON c.workspace_id=k.workspace_id AND c.id=k.chat_id WHERE k.workspace_id=? AND c.public_id=? AND k.public_id=?${write?' FOR UPDATE':''}`,
  [auth.workspace_id,chatPublicId,casePublicId]);
  if(!owner)throw storeError('CASE_NOT_FOUND',404,'Case不存在');
  const keys=[auth.workspace_id,owner.chat_id,owner.case_id];
  const order=await exchangeOrderContext(db,keys,write);
  const [applications]=await db.execute(`SELECT CAST(channel_id AS CHAR) AS channelId,app_no AS applicationNumber,status
    FROM applications WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id LIMIT 501${write?' FOR UPDATE':''}`,keys);
  if(applications.length>500)throw storeError('OPERATION_CAPACITY',409,'申请超过完整核对范围，请缩小Case范围');
  return {applications,events:order.events};
}
