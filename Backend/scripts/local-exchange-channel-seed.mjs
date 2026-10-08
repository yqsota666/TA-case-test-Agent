import mysql from 'mysql2/promise';
import {migrationConfig} from '../packages/platform-store/src/migrate.js';

const caseId=process.env.CASE_PUBLIC_ID;
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId??''))throw new Error('CASE_PUBLIC_ID is required');
const config=migrationConfig();
if(!['127.0.0.1','localhost','::1'].includes(config.host)||config.database!=='ta_case_agent_local')throw new Error('Only the local acceptance database may be initialized');
const db=await mysql.createConnection(config);
try{
  await db.beginTransaction();
  const [[owner]]=await db.execute('SELECT workspace_id FROM cases WHERE public_id=? FOR UPDATE',[caseId]);
  if(!owner)throw new Error('Case does not exist');
  const [existing]=await db.execute('SELECT id FROM exchange_channels WHERE workspace_id=? FOR UPDATE',[owner.workspace_id]);
  if(existing.length){await db.commit();console.log(JSON.stringify({created:false,channelIds:existing.map(c=>String(c.id))}));}
  else{
    const [profiles]=await db.execute("SELECT DISTINCT channel_name,ta_environment,ta_code,distributor_code,protocol_version FROM exchange_channels WHERE ta_environment='LOCAL'");
    if(profiles.length!==1)throw new Error('A single previously configured local TA profile is required');
    const p=profiles[0];
    const [result]=await db.execute('INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,?,?,?,?,?)',[owner.workspace_id,p.channel_name,p.ta_environment,p.ta_code,p.distributor_code,p.protocol_version]);
    await db.commit();console.log(JSON.stringify({created:true,workspaceId:owner.workspace_id,channelId:String(result.insertId),profile:p}));
  }
}catch(error){await db.rollback();throw error;}finally{await db.end();}
