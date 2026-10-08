import {authenticateSession} from './index.js';
export const demoEmail='local-demo@ta-agent.example.invalid';
export async function accountModelPolicy(db,userId,defaultDaily,{lock=false}={}) {
 const [[row]]=await db.execute(`SELECT u.public_id,d.user_id IS NOT NULL AS is_demo,q.daily_tokens FROM platform_users u LEFT JOIN account_model_quotas q ON q.user_id=u.id LEFT JOIN account_demo_users d ON d.user_id=u.id WHERE u.id=?${lock?' FOR UPDATE':''}`,[userId]);
 return {id:row.public_id,unlimited:Number(row.is_demo)===1,dailyTokens:Number(row.is_demo)===1?null:Number(row.daily_tokens??defaultDaily)};
}
export function createAccountModelQuotas({transaction,defaultDaily}) {
 async function actor(db,token) {
  const auth=await authenticateSession(db,token);
  const policy=await accountModelPolicy(db,auth.user_id,defaultDaily);
  return {...auth,policy};
 }
 return {
  usage:token=>transaction(async db=>{
   const auth=await actor(db,token);
   const [[clock]]=await db.execute("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),'%Y-%m-%d') AS day");
   const [records]=await db.execute(`SELECT model,purpose,status,reserved_tokens,charged_tokens,input_tokens,output_tokens,created_at,expires_at>NOW(3) AS active FROM model_consumption WHERE user_id=? AND budget_day=? ORDER BY created_at DESC LIMIT 50`,[auth.user_id,clock.day]);
   const [[totals]]=await db.execute(`SELECT COALESCE(SUM(IF(status='SETTLED',charged_tokens,0)),0) AS used,COALESCE(SUM(IF(status='RESERVED' AND expires_at>NOW(3),reserved_tokens,0)),0) AS reserved,COALESCE(SUM(IF(status='UNCERTAIN',charged_tokens,IF(status='RESERVED' AND expires_at<=NOW(3),reserved_tokens,0))),0) AS uncertain FROM model_consumption WHERE user_id=? AND budget_day=?`,[auth.user_id,clock.day]);
   const used=Number(totals.used),reserved=Number(totals.reserved),uncertain=Number(totals.uncertain);
   const midnight=new Date(clock.day+'T00:00:00+08:00');midnight.setTime(midnight.getTime()+86400000);
   return {...auth.policy,day:clock.day,resetAt:midnight.toISOString(),usedTokens:used,reservedTokens:reserved,uncertainTokens:uncertain,remainingTokens:auth.policy.unlimited?null:Math.max(0,auth.policy.dailyTokens-used-reserved-uncertain),records:records.map(r=>({...r,status:r.status==='RESERVED'&&Number(r.active)!==1?'UNCERTAIN':r.status,reserved_tokens:Number(r.reserved_tokens),charged_tokens:r.status==='RESERVED'&&Number(r.active)!==1?Number(r.reserved_tokens):r.charged_tokens===null?null:Number(r.charged_tokens)}))};
  }),
 };
}
