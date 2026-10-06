import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../../src/migrate.js';
import {createHoldingsReturnRepository} from '../../src/holdings-return.js';

export async function verifyHoldingsApplyRace({db,token,scope,parseId,channelId,confirmations,returnInput}){
 assert.match(migrationConfig().database,/^ta_case_agent_testholdingsrace[a-f0-9]+$/);
 await db.commit();
 const worker=await mysql.createConnection(migrationConfig());
 let signal;const waiting=new Promise(resolve=>{signal=resolve;});
 const repo=createHoldingsReturnRepository({transaction:async action=>{
  await worker.beginTransaction();
  try{
   const result=await action({execute:async(sql,args)=>{
    if(sql.includes('FROM exchange_channels')&&sql.includes('FOR UPDATE'))signal();
    return worker.execute(sql,args);
   }});await worker.commit();return result;
  }catch(error){await worker.rollback();throw error;}
 }});
 let pending;
 try{
  await db.beginTransaction();
  await db.execute('SELECT id FROM exchange_channels WHERE id=? FOR UPDATE',[channelId]);
  pending=repo.apply(token,{...scope,parseId});
  await waiting;
  // 05 already authenticated under REPEATABLE READ, but this real 04 is committed after that snapshot.
  await confirmations.apply(token,returnInput);
  await db.commit();
  const result=await pending;
  assert.equal(result.results[0].totalVolume,'650.00','05 must preserve the later 200-share 04 confirmation');
  const [[holding]]=await db.execute('SELECT total_volume,available_volume,frozen_volume FROM sales_confirmed_holdings WHERE workspace_id=(SELECT workspace_id FROM case_chats WHERE public_id=?) AND fund_code=\'000001\'',[scope.chatPublicId]);
  assert.equal(holding.total_volume,'650.00');assert.equal(holding.available_volume,null);assert.equal(holding.frozen_volume,null);
 }finally{
  await db.rollback();if(pending)await Promise.allSettled([pending]);await worker.end();await db.beginTransaction();
 }
}
