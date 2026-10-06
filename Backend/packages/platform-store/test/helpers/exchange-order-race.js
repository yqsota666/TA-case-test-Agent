import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrationConfig } from '../../src/migrate.js';
import { createReturnParsingRepository } from '../../src/return-parsing.js';
import { createReturnConfirmationRepository } from '../../src/return-confirmation.js';

const barrier=()=>{let release;const ready=new Promise(resolve=>{release=resolve;});return {ready,release};};
export async function verifyExchangeOrderRace({db,token,scope,batchPublicId}) {
  assert.match(migrationConfig().database,/^ta_case_agent_testexchangerace[a-f0-9]+$/);
  const [[owner]]=await db.execute('SELECT workspace_id,chat_id,id FROM cases WHERE public_id=?',[scope.casePublicId]);
  const keys=[owner.workspace_id,owner.chat_id,owner.id];
  for(const table of ['case_exchange_plan_receipts','case_exchange_plan_events','case_exchange_plan_bindings'])
    await db.execute(`DELETE FROM ${table} WHERE workspace_id=? AND chat_id=? AND case_id=?`,keys);
  await db.commit();
  const connections=await Promise.all([mysql.createConnection(migrationConfig()),mysql.createConnection(migrationConfig())]);
  const gates=[],pending=[];
  const transaction=(conn,hook)=>async action=>{
    await conn.beginTransaction();
    try {const result=await action({execute:async(sql,args)=>{const result=await conn.execute(sql,args);await hook(sql);return result;}});await conn.commit();return result;}
    catch(error){await conn.rollback();throw error;}
  };
  const upload={...scope,batchPublicId,expectedType:'04',exchangeStepId:'r04_1'};
  const graph=async()=>({phase:'PARSED',parsed:{rawFiles:[],result:{sha256:crypto.randomBytes(32).toString('hex'),files:[{date:'20261007',records:[]}]}}});
  try {
    const reached=barrier(),resume=barrier(),snapshot=barrier();gates.push(resume);
    const delivery=createReturnConfirmationRepository({transaction:transaction(connections[0],async sql=>{
      if(sql.includes('INSERT INTO case_exchange_plan_events')){reached.release();await resume.ready;}
    })});
    let authentications=0;
    const parsing=createReturnParsingRepository({transaction:transaction(connections[1],async sql=>{
      if(sql.includes('FROM platform_sessions') && ++authentications===2)snapshot.release();
    })});
    const sent=delivery.delivery(token,{...scope,batchPublicId,exchangeStepId:'s03_1'});pending.push(sent);
    await reached.ready;
    const parsed=parsing.parse(token,upload,graph);pending.push(parsed);await snapshot.ready;
    assert.equal(await Promise.race([parsed.then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),100))]),true);
    resume.release();await sent;assert.equal((await parsed).phase,'PARSED','current read must observe newly committed SENT despite pre-lock RR snapshot');

    const inserted=barrier(),allowCommit=barrier(),priorSnapshot=barrier();gates.push(allowCommit);
    const state=await graph();
    const first=createReturnParsingRepository({transaction:transaction(connections[0],async sql=>{
      if(sql.includes('INSERT INTO case_exchange_plan_receipts')){inserted.release();await allowCommit.ready;}
    })});
    let secondAuth=0;
    const second=createReturnParsingRepository({transaction:transaction(connections[1],async sql=>{
      if(sql.includes('FROM platform_sessions') && ++secondAuth===2)priorSnapshot.release();
    })});
    const a=first.parse(token,upload,async()=>state);pending.push(a);await inserted.ready;
    const b=second.parse(token,upload,async()=>state);pending.push(b);await priorSnapshot.ready;
    allowCommit.release();const results=await Promise.all([a,b]);
    assert.equal(results[0].parseId,results[1].parseId);assert.equal(results[1].duplicate,true);assert.equal(results[1].phase,'PARSED');
    const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM case_exchange_plan_receipts WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);
    assert.equal(Number(count.n),2,'two distinct packages, concurrent duplicate adds no receipt');
  } finally {for(const gate of gates)gate.release();await Promise.allSettled(pending);await Promise.all(connections.map(conn=>conn.end()));}
}
