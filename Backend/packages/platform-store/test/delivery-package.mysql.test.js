import test from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createExchangeRepository} from '../src/exchange.js';
import {createGlobalDataCatalog} from '../src/global-data-catalog.js';
import {createApplicationPreparationRepository} from '../src/application-preparation.js';
import {createApplicationPreparationService} from '../../case-api/src/prepare-applications.js';
import {createProjectExchangeService} from '../../case-api/src/project-exchange.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {indexedPlan} from '../../case-agent/test/indexed-package-fixture.js';
import {parseDataFile} from '../../platform-protocol/src/index.js';
import {buildApplicationPackage} from '../../platform-protocol/src/application-package.js';

for (const code of ['005','227','926']) test(`MySQL: ${code} persists full channel delivery package and isolates profile writes`, {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
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
  const catalog=createGlobalDataCatalog({transaction}),input={channel_name:'包合成',ta_environment:'synthetic',ta_code:'27',distributor_code:code,protocol_version:'22'};
  const channel=await catalog.saveDistributor(token,{input}),channelId=channel.id;
  assert.equal((await catalog.listTable(token,{table:'distributors'})).rows[0].distributor_code,code);
  assert.equal((await catalog.listTable(foreignToken,{table:'distributors'})).total,0);
  await assert.rejects(()=>catalog.saveDistributor(foreignToken,{id:channelId,input}),{code:'CHANNEL_NOT_FOUND'});
  await assert.rejects(()=>catalog.saveDistributor(token,{input}),{code:'DISTRIBUTOR_EXISTS'});
  await catalog.saveDistributor(token,{id:channelId,input:{...input,channel_name:'更名合成'}});
  const repository=createCaseRepository({transaction}),exchange=createExchangeRepository({transaction}),preparations=createApplicationPreparationRepository({transaction});
  assert.equal((await exchange.listChannels(token)).channels[0].name,'更名合成');
  const applicationPreparation=createApplicationPreparationService({repository,preparations,exchangeRepository:exchange,derive:()=>{throw new Error('no execution-time model');}});
  const project=createProjectExchangeService({repository,preparations,exchangeRepository:exchange,applicationPreparation});
  for(const accounts of [2]){
   const chat=await repository.createChat(token,'申请包演练'),item=await repository.createCase(token,chat.publicId,'全量开户交易');
   const scope={chatPublicId:chat.publicId,casePublicId:item.publicId},args=[token,scope.chatPublicId,scope.casePublicId],plan=JSON.parse(JSON.stringify(indexedPlan({accounts,rounds:2})).replaceAll('20261008','20260817'));
   plan.contract.dataSpecification.accounts.forEach(a=>a.branchCode=code);
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
    await assert.rejects(()=>exchange.stageApplication(token,{...scope,sopVersionId:data.planVersionId,channelId,businessDate:'20260817',fileType:'03',record:{...firstTrade,...wrong}}),{code:'APPLICATION_DATA_MISMATCH'});
   }
   const zip=buildApplicationPackage(originals);assert.equal(zip.fileNames.length,3);
   const delivery=await exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId});
   assert.equal(delivery.fileName,'20260817.zip');
   assert.equal(delivery.manifest.length,code==='227'?7:6);
   assert.equal(delivery.manifest.find(f=>f.fileType==='OFI').fileName,
     `${code}/20260817/OFI_${code}_27_20260817${code==='005'?'-DLJJ':''}.TXT`);
   if(process.env.DELIVERY_ARTIFACT_DIRECTORY){
    const directory=join(process.env.DELIVERY_ARTIFACT_DIRECTORY,code);mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,delivery.fileName),delivery.rawBytes);
   }
   await db.execute('UPDATE exchange_delivery_packages SET content_sha256=? WHERE workspace_id=? AND batch_id=(SELECT id FROM exchange_batches WHERE public_id=?)',
    ['0'.repeat(64),workspace.insertId,apps[0].batchPublicId]);
   await assert.rejects(()=>exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId}),{code:'FILE_INTEGRITY_ERROR'});
   await db.execute('UPDATE exchange_delivery_packages SET content_sha256=? WHERE workspace_id=? AND batch_id=(SELECT id FROM exchange_batches WHERE public_id=?)',
    [crypto.createHash('sha256').update(delivery.rawBytes).digest('hex'),workspace.insertId,apps[0].batchPublicId]);
   assert.ok(delivery.manifest.some(f=>f.fileType==='OFX'));
   assert.equal(delivery.manifest.find(f=>f.fileType==='X1').recordCount,accounts);
   assert.equal(delivery.manifest.find(f=>f.fileType==='X3').recordCount,0);
   const changedProfile={...(await exchange.readDeliveryProfile(token,{channelId})).profile,
     aml:false,includeEmptyR1:false,indexSuffixes:{OFI:'-PROFILE',OFX:''},directoryLayout:'date'};
   await catalog.saveDistributor(token,{id:channelId,input:{...input,channel_name:'格式更新合成',delivery_profile:changedProfile}});
   assert.equal((await catalog.listTable(token,{table:'distributors'})).rows[0].delivery_profile.indexSuffixes.OFI,'-PROFILE');
   const unchanged=await exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId});
   assert.deepEqual(unchanged.rawBytes,delivery.rawBytes);
   assert.equal(await exchange.readDeliveryPackage(foreignToken,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId}),null);
   await assert.rejects(()=>exchange.setDeliveryProfile(foreignToken,{channelId,profile:{aml:false}}),{code:'CHANNEL_NOT_FOUND'});
   await assert.rejects(()=>catalog.saveDistributor(foreignToken,{id:channelId,input:{...input,delivery_profile:changedProfile}}),{code:'CHANNEL_NOT_FOUND'});
   const replay=await project.prepare({token,...scope,channelId});assert.deepEqual(replay.files.map(f=>f.id),result.files.map(f=>f.id));
   assert.deepEqual((await exchange.listOutboundFiles(foreignToken,chat.publicId)).files,[]);
   await assert.rejects(()=>exchange.readOutboundFile(foreignToken,{chatPublicId:chat.publicId,fileId:result.files[0].id}),{code:'FILE_NOT_FOUND'});
   assert.equal((await exchange.listOutboundFiles('invalid-session',chat.publicId).catch(e=>({code:e.code}))).code,'UNAUTHENTICATED');
   const nextChat=await repository.createChat(token,'后续批次格式合成'),nextItem=await repository.createCase(token,nextChat.publicId,'格式更新合成');
   const nextScope={chatPublicId:nextChat.publicId,casePublicId:nextItem.publicId};
   const nextArgs=[token,nextScope.chatPublicId,nextScope.casePublicId],nextPlan=JSON.parse(JSON.stringify(plan).replaceAll('20260817','20260818'));
   await repository.saveSopProposal(...nextArgs,nextPlan);await repository.confirmSopProposal(...nextArgs,1,'DATA');await repository.confirmSopProposal(...nextArgs,1,'EXPECTATIONS');
   await repository.executeGeneratedData(...nextArgs,1,nextPlan.contract.dataSpecification,(conn,keys,specification)=>createDataGenerationGraph({db:conn,scope:keys,specification}).invoke({}));await repository.confirmGeneratedData(...nextArgs,0);
   await project.prepare({token,...nextScope,channelId});
   const nextApps=(await exchange.listCaseApplications(token,nextScope)).applications;
   const nextPackage=await exchange.readDeliveryPackage(token,{chatPublicId:nextChat.publicId,batchPublicId:nextApps[0].batchPublicId});
   assert.equal(nextPackage.manifest.length,3);assert.ok(nextPackage.manifest.some(f=>f.fileName===`20260818/OFI_${code}_27_20260818-PROFILE.TXT`));
   assert.ok(nextPackage.manifest.every(f=>!['OFX','X1','X3','R1'].includes(f.fileType)));
   assert.deepEqual((await exchange.readDeliveryPackage(token,{chatPublicId:chat.publicId,batchPublicId:apps[0].batchPublicId})).rawBytes,delivery.rawBytes);
  }
  const [[counts]]=await db.execute('SELECT (SELECT COUNT(*) FROM sales_confirmed_accounts WHERE workspace_id=?) AS accounts,(SELECT COUNT(*) FROM sales_confirmed_holdings WHERE workspace_id=?) AS holdings',[workspace.insertId,workspace.insertId]);assert.equal(Number(counts.accounts),0);assert.equal(Number(counts.holdings),0);
 }finally{await db.rollback();await db.end();}
});
