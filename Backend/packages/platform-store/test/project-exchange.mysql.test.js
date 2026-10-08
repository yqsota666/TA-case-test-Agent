import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createExchangeRepository} from '../src/exchange.js';
import {createApplicationPreparationRepository} from '../src/application-preparation.js';
import {createReturnParsingRepository} from '../src/return-parsing.js';
import {createReturnConfirmationRepository} from '../src/return-confirmation.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {createApplicationPreparationService} from '../../case-api/src/prepare-applications.js';
import {createReturnParsingService} from '../../case-api/src/return-parsing.js';
import {createReturnConfirmationService} from '../../case-api/src/return-confirmation.js';
import {createProjectExchangeService} from '../../case-api/src/project-exchange.js';
import {buildDataFile,dataFileName} from '../../platform-protocol/src/index.js';

test('MySQL: two Cases share 01/03, route original 02/04, and roll back the first Case when the second apply fails',
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());let counter=0;
 const transaction=async action=>{const save='project_'+ ++counter;await db.query('SAVEPOINT '+save);try{return await action(db);}catch(error){await db.query('ROLLBACK TO SAVEPOINT '+save);throw error;}};
 try{
  await db.beginTransaction();const token=crypto.randomBytes(32).toString('base64url'),uid=crypto.randomUUID();
  const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成跨Case验收')",[uid,uid+'@example.invalid','synthetic']);
  const [ws]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  const [channel]=await db.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'synthetic','synthetic','27','306','22')",[ws.insertId]);const channelId=String(channel.insertId);
  const repo=createCaseRepository({transaction}),exchange=createExchangeRepository({transaction}),preparations=createApplicationPreparationRepository({transaction});
  const parsing=createReturnParsingService({repository:createReturnParsingRepository({transaction})});
  const confirmations=createReturnConfirmationService({repository:createReturnConfirmationRepository({transaction})});
  const preparation=createApplicationPreparationService({repository:repo,preparations,exchangeRepository:exchange,confirmedSales:confirmations,derive:()=>{throw Error('strict fixture must not call a model');}});
  let appliedJobs=[];
  const project=createProjectExchangeService({repository:repo,preparations,exchangeRepository:exchange,applicationPreparation:preparation,returnParsing:parsing,returnConfirmation:confirmations,
   applyAtomically:(token,jobs)=>transaction(async conn=>{const service=createReturnConfirmationService({repository:createReturnConfirmationRepository({transaction:action=>action(conn)})});const results=[];appliedJobs=[];
    for(const [index,job]of jobs.entries()){results.push(await service.apply(token,job));appliedJobs.push(job.casePublicId);}return {projectResults:results,businessApplied:true};})});
  const chat=await repo.createChat(token,'合成多Case统一交换'),members=[];
  for(let i=0;i<2;i++){
   const c=await repo.createCase(token,chat.publicId,'合成Case'+i),scope={chatPublicId:chat.publicId,casePublicId:c.publicId};
   const [[ids]]=await db.execute('SELECT id,chat_id FROM cases WHERE workspace_id=? AND public_id=?',[ws.insertId,c.publicId]);
   const spec={customers:[{name:'合成客户'+i,investorType:'1',simulatedBalance:'1000.00'}],accounts:[{customerIndex:0,branchCode:'306'}],funds:[{fundCode:'000001',fundName:'合成基金',shareClass:'0',nav:'1.00000000'}],holdings:[],missing:[]};
   const step=(suffix,fileType,date,dependsOn=[])=>({stepId:`c${i}_${suffix}`,direction:['01','03'].includes(fileType)?'SEND':'RECEIVE',fileType,roundId:['01','02'].includes(fileType)?'open':'trade',businessTime:{kind:'DATE',value:date},required:true,dependsOn});
   const plan={objective:'合成文件链路',preconditions:[],openQuestions:[],scenarios:[],exchangePlan:{status:'READY',openQuestions:[],steps:[step('send01','01','20261006'),step('receive02','02','20261007',[{stepId:`c${i}_send01`,condition:'SENT'}]),step('send03','03','20261008',[{stepId:`c${i}_receive02`,condition:'CONFIRMED'}]),step('receive04','04','20261009',[{stepId:`c${i}_send03`,condition:'SENT'}])]},contract:{protocolVersion:'22',dataSpecification:spec,applications:[{key:'opening',stepId:`c${i}_send01`,businessCode:'001',accountIndex:0,transactionAccountId:null,fundIndex:null,fields:{TransactionTime:'120000',CertificateType:'0',CertificateNo:'SYNTHETIC'+i}},{key:'purchase',stepId:`c${i}_send03`,businessCode:'022',accountIndex:0,transactionAccountId:null,fundIndex:0,fields:{TransactionTime:'120000',ApplicationAmount:'100.00',CurrencyType:'156',ChargeType:'0'}}]}};
   await db.execute("UPDATE cases SET status='SOP_LOCKED' WHERE workspace_id=? AND id=?",[ws.insertId,ids.id]);
   await db.execute("INSERT INTO case_sop_versions(workspace_id,chat_id,case_id,version_number,plan_json,status,locked_at) VALUES (?,?,?,1,?,'LOCKED',NOW(3))",[ws.insertId,ids.chat_id,ids.id,JSON.stringify(plan)]);
   await repo.executeGeneratedData(token,chat.publicId,c.publicId,1,spec,(conn,keys,data)=>createDataGenerationGraph({db:conn,scope:keys,specification:data}).invoke({}));
   await repo.confirmGeneratedData(token,chat.publicId,c.publicId,0);members.push(scope);
  }
  const first=members[0];
  async function corruptSecondOriginal(parsed){const id=parsed.projectParses.find(p=>p.casePublicId===members[1].casePublicId).parseId;const [[stored]]=await db.execute('SELECT file_name,raw_bytes FROM case_return_parse_files WHERE workspace_id=? AND parse_id=? ORDER BY file_name LIMIT 1',[ws.insertId,id]);await db.execute('UPDATE case_return_parse_files SET raw_bytes=CONCAT(raw_bytes,?) WHERE workspace_id=? AND parse_id=? AND file_name=?',[Buffer.from('corrupt-synthetic-only'),ws.insertId,id,stored.file_name]);return ()=>db.execute('UPDATE case_return_parse_files SET raw_bytes=? WHERE workspace_id=? AND parse_id=? AND file_name=?',[stored.raw_bytes,ws.insertId,id,stored.file_name]);}

  await project.prepare({token,...first,channelId});
  let outbound=(await exchange.listOutboundFiles(token,chat.publicId)).files;assert.equal(outbound.length,1);assert.equal(outbound[0].fileType,'01');assert.equal(outbound[0].recordCount,2);
  const apps01=await Promise.all(members.map(async scope=>(await exchange.listCaseApplications(token,scope)).applications.find(a=>a.fileType==='01')));
  const [[batchCount]]=await db.execute('SELECT COUNT(*) AS n FROM exchange_batches WHERE workspace_id=?',[ws.insertId]);assert.equal(Number(batchCount.n),1);
  async function receive(type,date,batchPublicId,records){
   const groups=type==='04'?records.map(record=>[record]):[records];
   const originals=groups.map((rows,index)=>{const opts={creator:'27',receiver:'306',date,version:'22',fileType:type,sequence:901+index};return {fileName:dataFileName(opts),raw:buildDataFile({...opts,records:rows})};});
   const files=originals.map(file=>({fileName:file.fileName,base64:file.raw.toString('base64')}));
   // A prior direct upload in the sibling's reversed file order has the same package digest.
   // Project fanout must retain those bytes and convert indexes, rather than assuming matching array order.
   if(type==='04')await parsing.parse(token,{...members[1],batchPublicId,expectedType:type,exchangeStepId:'c1_receive04',files:[...files].reverse()});
   const parsed=await project.parse(token,{...first,batchPublicId,expectedType:type,exchangeStepId:`c0_receive${type}`,files});assert.equal(parsed.phase,'PARSED');assert.equal(parsed.projectParses.length,2);
   const [storedFiles]=await db.execute('SELECT file_name,raw_bytes FROM case_return_parse_files WHERE workspace_id=? AND parse_id IN (?,?)',[ws.insertId,...parsed.projectParses.map(p=>p.parseId)]);
   assert.equal(storedFiles.length,files.length*2);for(const stored of storedFiles)assert.deepEqual(stored.raw_bytes,originals.find(f=>f.fileName===stored.file_name).raw);
   return parsed;
  }
  const batch01=apps01[0].batchPublicId;assert.equal(apps01[1].batchPublicId,batch01);
  await confirmations.delivery(token,{...first,batchPublicId:batch01,exchangeStepId:'c0_send01'});
  const rows01=await Promise.all(apps01.map(async app=>{const [[row]]=await db.execute('SELECT record_json FROM applications WHERE workspace_id=? AND public_id=?',[ws.insertId,app.publicId]);return typeof row.record_json==='string'?JSON.parse(row.record_json):row.record_json;}));
  const r02=await receive('02','20261007',batch01,rows01.map((record,i)=>({...record,BusinessCode:'101',ReturnCode:'0000',TAAccountID:'SYNTA'+i,TASerialNO:'SYNCFMOPEN'+i,TransactionCfmDate:'20261007'})));
  assert.equal((await confirmations.salesData(token)).accounts.length,0);
  const restore02=await corruptSecondOriginal(r02);await assert.rejects(project.apply(token,{...first,parseId:r02.parseId,recordIndexes:[0,1],exchangeStepId:'c0_receive02'}),{code:'RETURN_SOURCE_INVALID'});assert.deepEqual(appliedJobs,[first.casePublicId]);
  assert.equal((await confirmations.salesData(token)).accounts.length,0);assert.equal((await confirmations.read(token,first)).confirmations.length,0);
  await restore02();await project.apply(token,{...first,parseId:r02.parseId,recordIndexes:[0,1],exchangeStepId:'c0_receive02'});assert.equal((await confirmations.salesData(token)).accounts.length,2);
  await project.prepare({token,...first,channelId});outbound=(await exchange.listOutboundFiles(token,chat.publicId)).files;assert.equal(outbound.length,2);assert.equal(outbound.find(f=>f.fileType==='03').recordCount,2);
  const apps03=await Promise.all(members.map(async scope=>(await exchange.listCaseApplications(token,scope)).applications.find(a=>a.fileType==='03')));assert.equal(apps03[0].batchPublicId,apps03[1].batchPublicId);
  await confirmations.delivery(token,{...first,batchPublicId:apps03[0].batchPublicId,exchangeStepId:'c0_send03'});
  const rows03=await Promise.all(apps03.map(async app=>{const [[row]]=await db.execute('SELECT record_json FROM applications WHERE workspace_id=? AND public_id=?',[ws.insertId,app.publicId]);return typeof row.record_json==='string'?JSON.parse(row.record_json):row.record_json;}));
  const r04=await receive('04','20261009',apps03[0].batchPublicId,rows03.map((record,i)=>({...record,BusinessCode:'122',ReturnCode:'0000',TASerialNO:'SYNCFMTRADE'+i,TransactionCfmDate:'20261009',ConfirmedAmount:'100.00',ConfirmedVol:'100.00',NAV:'1.00000000',BusinessFinishFlag:'1'})));
  const before=await confirmations.salesData(token);const restore04=await corruptSecondOriginal(r04);await assert.rejects(project.apply(token,{...first,parseId:r04.parseId,recordIndexes:[0,1]}),{code:'RETURN_SOURCE_INVALID'});assert.deepEqual(await confirmations.salesData(token),before);
  await restore04();await project.apply(token,{...first,parseId:r04.parseId,recordIndexes:[0,1]});const sales=await confirmations.salesData(token);assert.equal(sales.transactions.length,2);assert.equal(sales.holdings.length,2);assert.ok(sales.holdings.every(h=>h.totalVolume==='100.00'));
  const aggregate=await project.readConfirmation(token,first);assert.deepEqual(aggregate.confirmations.filter(c=>c.parseId===r04.parseId).map(c=>c.recordIndex).sort(),[0,1]);
  await project.apply(token,{...first,parseId:r04.parseId,recordIndexes:[0,1]});assert.deepEqual(await confirmations.salesData(token),sales);
  await project.prepare({token,...first,channelId});assert.equal((await exchange.listOutboundFiles(token,chat.publicId)).files.length,2);
 }finally{await db.rollback();await db.end();}
});
