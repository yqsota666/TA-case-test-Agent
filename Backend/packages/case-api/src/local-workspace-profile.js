export function localWorkspaceInitializer(config,{localDatabase=process.env.CASE_LOCAL_DEMO_DATABASE ?? 'ta_case_agent_local'}={}) {
  if(!['127.0.0.1','localhost'].includes(config.host)||config.database!==localDatabase)return undefined;
  return async (db,workspaceId)=>{
    const [profiles]=await db.execute("SELECT DISTINCT channel_name,ta_environment,ta_code,distributor_code,protocol_version FROM exchange_channels WHERE ta_environment='LOCAL'");
    if(profiles.length!==1)return;
    const p=profiles[0];
    await db.execute('INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,?,?,?,?,?)',[workspaceId,p.channel_name,p.ta_environment,p.ta_code,p.distributor_code,p.protocol_version]);
  };
}
