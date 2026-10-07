import {storeError} from '../../platform-store/src/index.js';

export function localWorkspaceInitializer(config) {
  if(!['127.0.0.1','localhost'].includes(config.host)||config.database!=='ta_case_agent_local')return undefined;
  return async (db,workspaceId)=>{
    const [profiles]=await db.execute("SELECT DISTINCT channel_name,ta_environment,ta_code,distributor_code,protocol_version FROM exchange_channels WHERE ta_environment='LOCAL'");
    if(profiles.length!==1)throw storeError('LOCAL_PROFILE_REQUIRED',409,'本地 TA 协议配置不唯一，请先配置本地交换环境');
    const p=profiles[0];
    await db.execute('INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,?,?,?,?,?)',[workspaceId,p.channel_name,p.ta_environment,p.ta_code,p.distributor_code,p.protocol_version]);
  };
}
