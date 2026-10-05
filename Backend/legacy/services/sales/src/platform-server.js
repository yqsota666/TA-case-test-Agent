import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { readPlatformConfig,createPlatformPool,transactional } from './platform/connection.js';
import { createPlatformApp } from './platform/http-app.js';
import {readAgentConfig,createSophnetModel} from './agent/config.js';
import {createAgentService,startAgentWorker} from './agent/service.js';
import {createPersistentCheckpointer} from './agent/checkpointer.js';
const envFile=fileURLToPath(new URL('../../../.env.platform.local',import.meta.url));
const pool=createPlatformPool(readPlatformConfig(envFile));
await pool.execute('SELECT original_bytes FROM exchange_file_contents LIMIT 0');
const transaction=transactional(pool);
let agent,worker,checkpointer;
if(process.env.AGENT_ENABLED==='1'){
  await pool.execute('SELECT run_id FROM agent_runs LIMIT 0');
  const config=readAgentConfig(fileURLToPath(new URL('../../../.env.agent.local',import.meta.url)));
  await pool.execute('SELECT step_key FROM agent_components LIMIT 0');
  await pool.execute('SELECT proposal_id FROM agent_plan_proposals LIMIT 0');
  checkpointer=await createPersistentCheckpointer(config.checkpointURL);
  agent=createAgentService({transaction,model:createSophnetModel(config),modelId:config.modelId,timeoutMs:config.timeoutMs,checkpointer});
  worker=startAgentWorker(agent,{onError:details=>console.error('agent worker failed',details)});
}
const port=Number(process.env.PLATFORM_PORT||8083),host=process.env.PLATFORM_HOST||'127.0.0.1';
const app=createPlatformApp({transaction,agent});
const webDist=fileURLToPath(new URL('../../../web/dist/',import.meta.url));
if(existsSync(webDist)){
  app.use('/assets',express.static(`${webDist}assets`,{immutable:true,maxAge:'1y'}));
  app.get(/^\/workflow(?:\/.*)?$/,(_req,res)=>res.sendFile(`${webDist}index.html`));
}
const server=app.listen(port,host,()=>console.log(`模拟销售平台 API http://${host}:${port}/api (sales_platform_v2)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{if(worker)await worker.stop();if(checkpointer)await checkpointer.end();await pool.end();process.exit(0);}));
