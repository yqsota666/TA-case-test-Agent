import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createExchangeRepository} from '../src/exchange.js';
import {createApplicationPreparationRepository} from '../src/application-preparation.js';
import {createApplicationPreparationService} from '../../case-api/src/prepare-applications.js';
import {createProjectExchangeService} from '../../case-api/src/project-exchange.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {indexedPlan} from '../../case-agent/test/indexed-package-fixture.js';
import {parseDataFile} from '../../platform-protocol/src/index.js';
import {buildApplicationPackage} from '../../platform-protocol/src/application-package.js';

test('MySQL: all 01/03 records share one batch and ZIP before any receipt; retry and tenant isolation', {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());let n=0;
 const transaction=async fn=>{const s='indexed_'+ ++n;await db.query('SAVEPOINT '+s);try{return await fn(db);}catch(e){await db.query('ROLLBACK TO SAVEPOINT '+s);throw e;}};
 try{
  await db.beginTransaction();const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
  const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'申请包合成验收')",[id,id+'@example.invalid','synthetic']);
  const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
  const foreignId=crypto.randomUUID(),foreignToken=crypto.randomBytes(32).toString('base64url');
  const [foreignUser]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'Foreign synthetic')",[foreignId,foreignId+'@example.invalid','synthetic']);
  await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),foreignUser.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(foreignToken),foreignUser.insertId]);
  const [channel]=await db.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'包合成','synthetic','27','306','22')",[workspace.insertId]);
  const channelId=String(channel.insertId),repository=createCaseRepository({transaction}),exchange=createExchangeRepository({transaction}),preparations=createApplicationPreparationRepository({transaction});
  const applicationPreparation=createApplicationPreparationService({repository,preparations,exchangeRepository:exchange,derive:()=>{throw new Error('no execution-time model');}});
  const project=createProjectExchangeService({repository,preparations,exchangeRepository:exchange,applicationPreparation});
  for(const accounts of [1,2,4]){
   const chat=await repository.createChat(token,'申请包演练'),item=await repository.createCase(token,chat.publicId,'全量开户交易');
   const scope={chatPublicId:chat.publicId,casePublicId:item.publicId},args=[token,scope.chatPublicId,scope.casePublicId],plan=indexedPlan({accounts,rounds:2});
   await repository.saveSopProposal(...args,plan);await repository.confirmSopProposal(...args,1,'DATA');await repository.confirmSopProposal(...args,1,'EXPECTATIONS');
   await repository.executeGeneratedData(...args,1,plan.contract.dataSpecification,(conn,keys,specification)=>createDataGenerationGraph({db:conn,scope:keys,specification}).invoke({}));await repository.confirmGeneratedData(...args,0);
   const result=await project.prepare({token,...scope,channelId});
   const apps=(await exchange.listCaseApplications(token,scope)).applications;
   assert.equal(apps.length,accounts*3);assert.ok(apps.every(a=>a.status==='GENERATED'));assert.equal(new Set(apps.map(a=>a.batchPublicId)).size,1);
   assert.deepEqual(result.waiting,[]);assert.equal(result.files.length,2);
   const originals=await Promise.all(result.files.map(f=>exchange.readOutboundFile(token,{chatPublicId:chat.publicId,fileId:f.id})));
   const records=originals.map(f=>parseDataFile(f.rawBytes));assert.equal(records.find(f=>f.fileType==='01').records.length,accounts);assert.equal(records.find(f=>f.fileType==='03').records.length,accounts*2);
   assert.ok(records.find(f=>f.fileType==='03').records.every(r=>!r.TAAccountID?.trim()));
   assert.deepEqual(records.find(f=>f.fileType==='03').records.map(r=>r.BusinessCode),[...Array(accounts).fill('022'),...Array(accounts).fill('024')]);
   for(const record of records.find(f=>f.fileType==='03').records){
    const opening=records.find(f=>f.fileType==='01').records.find(r=>r.TransactionAccountID===record.TransactionAccountID);
    assert.equal(record.OriginalAppDate,opening.TransactionDate);assert.equal(record.OriginalAppSheetNo,opening.AppSheetSerialNo);
   }
   const data=await repository.generatedData(...args);
   const firstTrade=records.find(f=>f.fileType==='03').records[0];
   for(const wrong of [{OriginalAppDate:''},{OriginalAppSheetNo:'WRONG'},...(accounts>1?[{OriginalAppSheetNo:records.find(f=>f.fileType==='01').records[1].AppSheetSerialNo}]:[])]){
    await assert.rejects(()=>exchange.stageApplication(token,{...scope,sopVersionId:data.planVersionId,channelId,businessDate:'20261008',fileType:'03',record:{...firstTrade,...wrong}}),{code:'APPLICATION_DATA_MISMATCH'});
   }
   const zip=buildApplicationPackage(originals);assert.equal(zip.fileNames.length,3);
   const delivery=await exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId});
   assert.equal(delivery.fileName,'20261008.zip');
   assert.ok(delivery.manifest.some(f=>f.fileType==='OFX'));
   assert.equal(delivery.manifest.find(f=>f.fileType==='X1').recordCount,accounts);
   assert.equal(delivery.manifest.find(f=>f.fileType==='X3').recordCount,0);
   await exchange.setDeliveryProfile(token,{channelId,profile:{includeEmptyR1:true,indexSuffixes:{OFI:'-TEST'}}});
   const unchanged=await exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId});
   assert.deepEqual(unchanged.rawBytes,delivery.rawBytes);
   assert.equal(await exchange.readDeliveryPackage(foreignToken,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId}),null);
   await assert.rejects(()=>exchange.setDeliveryProfile(foreignToken,{channelId,profile:{aml:false}}),{code:'CHANNEL_NOT_FOUND'});
   const replay=await project.prepare({token,...scope,channelId});assert.deepEqual(replay.files.map(f=>f.id),result.files.map(f=>f.id));
   assert.deepEqual((await exchange.listOutboundFiles(foreignToken,chat.publicId)).files,[]);
   await assert.rejects(()=>exchange.readOutboundFile(foreignToken,{chatPublicId:chat.publicId,fileId:result.files[0].id}),{code:'FILE_NOT_FOUND'});
   assert.equal((await exchange.listOutboundFiles('invalid-session',chat.publicId).catch(e=>({code:e.code}))).code,'UNAUTHENTICATED');
  }
  const [[counts]]=await db.execute('SELECT (SELECT COUNT(*) FROM sales_confirmed_accounts WHERE workspace_id=?) AS accounts,(SELECT COUNT(*) FROM sales_confirmed_holdings WHERE workspace_id=?) AS holdings',[workspace.insertId,workspace.insertId]);assert.equal(Number(counts.accounts),0);assert.equal(Number(counts.holdings),0);
 }finally{await db.rollback();await db.end();}
});
