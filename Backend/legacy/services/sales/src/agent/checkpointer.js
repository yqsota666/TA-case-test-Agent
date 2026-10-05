import pg from 'pg';
import {PostgresSaver} from '@langchain/langgraph-checkpoint-postgres';

export async function createPersistentCheckpointer(connectionString) {
  if(!connectionString)throw Object.assign(new Error('缺少 AGENT_CHECKPOINT_URL'),{code:'CHECKPOINT_CONFIG'});
  const url=new URL(connectionString);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.pathname||url.pathname==='/')throw new Error('checkpoint数据库地址无效');
  const pool=new pg.Pool({connectionString,max:4,connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:15000});
  pool.on('error',()=>console.error('checkpoint idle connection failed',{code:'CHECKPOINT_UNAVAILABLE'}));
  const saver=new PostgresSaver(pool);
  try{
    for(let attempt=0;attempt<3;attempt++){
      try{await saver.setup();return saver;}catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,250*2**attempt));}
    }
  }catch(error){await pool.end();throw Object.assign(new Error('checkpoint初始化失败'),{code:'CHECKPOINT_UNAVAILABLE',cause:error});}
}
