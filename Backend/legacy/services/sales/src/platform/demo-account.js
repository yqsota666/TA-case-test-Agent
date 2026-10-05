import crypto from 'node:crypto';
import {hashPassword,newSession} from '../auth.js';
import {fail,syntheticCertificate} from './workflow-service.js';

export const DEMO_EMAIL='demo@platform.local';
export async function createPlatformUser(db,{name,email,passwordHash}){
  const publicId=crypto.randomUUID(),[u]=await db.execute('INSERT INTO platform_users(public_id,display_name,email,password_hash) VALUES (?,?,?,?)',[publicId,name,email,passwordHash]);
  const [w]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),u.insertId]);
  const environmentKey=process.env.PLATFORM_TA_ENVIRONMENT_KEY||'company-test-ta';
  await db.execute('INSERT INTO ta_environments(public_id,environment_name,environment_key) VALUES (?,?,?) ON DUPLICATE KEY UPDATE environment_key=VALUES(environment_key)',[crypto.randomUUID(),'公司内网 test TA',environmentKey]);
  const [[env]]=await db.execute('SELECT id FROM ta_environments WHERE environment_key=?',[environmentKey]);
  const ta=process.env.PLATFORM_TA_CODE||'27',org=process.env.PLATFORM_ORG_CODE||'305';
  if(!/^\d{1,9}$/.test(ta)||!/^\d{1,9}$/.test(org))fail('服务器 TA 通道配置无效');
  await db.execute('INSERT INTO exchange_channels(workspace_id,ta_environment_id,ta_code,distributor_code) VALUES (?,?,?,?)',[w.insertId,env.id,ta,org]);
  return {userId:u.insertId,workspaceId:w.insertId,publicId};
}
// Internal keys allow isolated fixtures; HTTP never accepts these values from clients.
export function createDemoLogin({transaction,key='local-demo',email=DEMO_EMAIL}){
  return async()=>{
    const passwordHash=await hashPassword(crypto.randomBytes(32).toString('base64url'));
    return transaction(async db=>{
      await db.execute('INSERT IGNORE INTO platform_demo_accounts(demo_key) VALUES (?)',[key]);
      const [[marker]]=await db.execute('SELECT user_id,seeded_at FROM platform_demo_accounts WHERE demo_key=? FOR UPDATE',[key]);
      let userId=marker.user_id;
      if(!userId){
        const [[existing]]=await db.execute('SELECT id FROM platform_users WHERE email=?',[email]);if(existing)fail('模拟账号配置冲突','DEMO_CONFLICT',409);
        const created=await createPlatformUser(db,{name:'模拟账号',email,passwordHash});userId=created.userId;
        await db.execute('UPDATE platform_demo_accounts SET user_id=? WHERE demo_key=?',[userId,key]);
      }
      const [[user]]=await db.execute('SELECT public_id,display_name,email,created_at,status FROM platform_users WHERE id=?',[userId]);
      if(user.status!=='ACTIVE')fail('模拟账号已停用','DEMO_DISABLED',403);
      if(!marker.seeded_at){
        const [[workspace]]=await db.execute('SELECT id FROM workspaces WHERE owner_user_id=?',[userId]),w=workspace.id;
        const [fund]=await db.execute("INSERT INTO catalog_funds(workspace_id,fund_code,share_class,fund_name,nav) VALUES (?,'000001','0','模拟基金','1.00000000')",[w]);
        for(let n=1;n<=3;n++){
          const [c]=await db.execute(`INSERT INTO catalog_customers(public_id,workspace_id,investor_name,investor_type,certificate_type,certificate_no,branch_code,simulated_balance,profile_json) VALUES (?,?,?,'1','0',?,?,'100000.00','{}')`,[crypto.randomUUID(),w,`模拟客户${n}`,syntheticCertificate(),process.env.PLATFORM_ORG_CODE||'305']);
          await db.execute("INSERT INTO catalog_positions(workspace_id,customer_id,fund_id,total_volume,available_volume,frozen_volume) VALUES (?,?,?,'1000.00','1000.00','0.00')",[w,c.insertId,fund.insertId]);
        }
        await db.execute('UPDATE platform_demo_accounts SET seeded_at=CURRENT_TIMESTAMP(3) WHERE demo_key=?',[key]);
      }
      const s=newSession();await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[s.tokenHash,userId,s.expiresAt]);
      return {user:{id:user.public_id,name:user.display_name,email:user.email,createdAt:user.created_at},token:s.token};
    });
  };
}
