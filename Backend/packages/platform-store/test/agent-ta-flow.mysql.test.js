import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createSophnetCompletion} from '../../case-agent/src/sophnet.js';
import {createCaseResultGraph} from '../../case-agent/src/case-result-graph.js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createExchangeRepository} from '../src/exchange.js';
import {createApplicationPreparationRepository} from '../src/application-preparation.js';
import {createReturnParsingRepository} from '../src/return-parsing.js';
import {createReturnConfirmationRepository} from '../src/return-confirmation.js';
import {createCaseResultRepository} from '../src/case-result.js';
import {createApplicationPreparationService} from '../../case-api/src/prepare-applications.js';
import {createProjectExchangeService} from '../../case-api/src/project-exchange.js';
import {createReturnParsingService} from '../../case-api/src/return-parsing.js';
import {createReturnConfirmationService} from '../../case-api/src/return-confirmation.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {compareConfirmedExpectations} from '../../case-agent/src/case-result-graph.js';
import {indexedPlan} from '../../case-agent/test/indexed-package-fixture.js';
import {buildDataFile,dataFileName,parseDataFile} from '../../platform-protocol/src/index.js';

// Optional local model output goes through the same plan validators as the fixture.
for(const count of [1,3,10])test(`MySQL: ${count} accounts use accepted nine-file delivery, then explicit synthetic 02/04 apply exactly once`,
 {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
 const db=await mysql.createConnection(migrationConfig());let sequence=0;
 const transaction=async fn=>{const save='agent_flow_'+ ++sequence;await db.query('SAVEPOINT '+save);try{return await fn(db);}catch(e){await db.query('ROLLBACK TO SAVEPOINT '+save);throw e;}};
 try{
  await db.beginTransaction();const uid=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
  const [u]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'合成链路验收')",[uid,uid+'@example.invalid','synthetic']);
  const [w]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),u.insertId]);
  await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),u.insertId]);
  const [ch]=await db.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'九文件合成验收','synthetic','27','227','22')",[w.insertId]);
  const channelId=String(ch.insertId),repository=createCaseRepository({transaction}),exchange=createExchangeRepository({transaction});
  const confirmations=createReturnConfirmationService({repository:createReturnConfirmationRepository({transaction})});
  const parsing=createReturnParsingService({repository:createReturnParsingRepository({transaction})});
  const preparation=createApplicationPreparationService({repository,preparations:createApplicationPreparationRepository({transaction}),exchangeRepository:exchange,confirmedSales:confirmations,derive:()=>{throw Error('confirmed plan must execute without replanning');}});
  const project=createProjectExchangeService({repository,preparations:createApplicationPreparationRepository({transaction}),exchangeRepository:exchange,applicationPreparation:preparation});
  const chat=await repository.createChat(token,'九文件合成演练'),item=await repository.createCase(token,chat.publicId,'开户申购合成演练');
  const scope={chatPublicId:chat.publicId,casePublicId:item.publicId},args=[token,scope.chatPublicId,scope.casePublicId];
  const live=count===10&&process.env.CASE_AGENT_FLOW_PLAN;
  const plan=live?JSON.parse(readFileSync(process.env.CASE_AGENT_FLOW_PLAN,'utf8')):JSON.parse(JSON.stringify(indexedPlan({accounts:count,rounds:1})).replaceAll('20261008','20260818').replaceAll('000001','270008'));
  plan.contract.dataSpecification.accounts.forEach(a=>a.branchCode='227');
  assert.equal(plan.contract.dataSpecification.accounts.length,count);
  assert.deepEqual(plan.contract.missing,[]);assert.deepEqual(plan.contract.dataSpecification.missing,[]);assert.deepEqual(plan.openQuestions,[]);
  await repository.saveSopProposal(...args,plan);
  await repository.confirmSopProposal(...args,1,'DATA');
  await assert.rejects(()=>project.prepare({token,...scope,channelId}));
  await repository.confirmSopProposal(...args,1,'EXPECTATIONS');
  await repository.executeGeneratedData(...args,1,plan.contract.dataSpecification,(db,keys,specification)=>createDataGenerationGraph({db,scope:keys,specification}).invoke({}));
  await repository.confirmGeneratedData(...args,0,{planVersionNumber:1});
  const result=await project.prepare({token,...scope,channelId});assert.deepEqual(result.waiting,[]);
  const apps=(await exchange.listCaseApplications(token,scope)).applications;
  assert.equal(apps.length,count*2);assert.equal(new Set(apps.map(a=>a.batchPublicId)).size,1);
  const batchPublicId=apps[0].batchPublicId;
  const zip=await exchange.readDeliveryPackage(token,{chatPublicId:scope.chatPublicId,batchPublicId});
  assert.equal(zip.fileName,'20260818.zip');assert.equal(zip.manifest.length,9);assert.ok(zip.manifest.every(f=>f.fileName.startsWith('20260818/')));
  for(const type of ['01','03','X1'])assert.equal(zip.manifest.find(f=>f.fileType===type).recordCount,count);
  for(const type of ['X3','R1','43'])assert.equal(zip.manifest.find(f=>f.fileType===type).recordCount,0);
  const before=await confirmations.salesData(token);assert.equal(before.accounts.length,0);assert.equal(before.holdings.length,0);
  const originals=await Promise.all(result.files.map(f=>exchange.readOutboundFile(token,{chatPublicId:scope.chatPublicId,fileId:f.id})));
  const source=originals.map(f=>parseDataFile(f.rawBytes));const opens=source.find(f=>f.fileType==='01').records,trades=source.find(f=>f.fileType==='03').records;
  for(const t of trades){const a=opens.find(a=>a.TransactionAccountID===t.TransactionAccountID);assert.ok(a);assert.equal(t.OriginalAppSheetNo,a.AppSheetSerialNo);assert.equal(t.OriginalAppDate,a.TransactionDate);assert.equal(t.TAAccountID,null);}
  const sends=plan.exchangePlan.steps.filter(s=>s.direction==='SEND');
  await confirmations.delivery(token,{...scope,batchPublicId,exchangeSteps:sends.map(s=>({casePublicId:scope.casePublicId,fileType:s.fileType,stepId:s.stepId}))});
  if(count===1){
   const step=plan.exchangePlan.steps.find(s=>s.fileType==='04'),wire={creator:'27',receiver:'227',date:'20260818',version:'22',fileType:'04',sequence:800};
   const record={...trades[0],BusinessCode:'122',ReturnCode:'0000',TAAccountID:'SYNTA0',TASerialNO:'EARLY04',TransactionCfmDate:'20260818',ConfirmedAmount:'100.00',ConfirmedVol:'100.00',NAV:'1.00000000',BusinessFinishFlag:'1'};
   const parsed=await parsing.parse(token,{...scope,batchPublicId,expectedType:'04',exchangeStepId:step.stepId,files:[{fileName:dataFileName(wire),base64:buildDataFile({...wire,records:[record]}).toString('base64')}]});
   assert.equal(parsed.phase,'PARSED');
   await assert.rejects(()=>confirmations.apply(token,{...scope,parseId:parsed.parseId,recordIndexes:[0],exchangeStepId:step.stepId}),{code:'SALES_ACCOUNT_UNCONFIRMED'});
   assert.equal((await confirmations.salesData(token)).holdings.length,0);
  }
  for(const [type,business,rows] of [['02','101',opens],['04','122',trades]]){
   const step=plan.exchangePlan.steps.find(s=>s.fileType===type);
   const records=rows.map((r,i)=>({...r,BusinessCode:business,ReturnCode:'0000',TAAccountID:`SYNTA${i}`,TASerialNO:`SYN${type}${i}`,TransactionCfmDate:'20260818',BusinessFinishFlag:'1',...(type==='04'?{ConfirmedAmount:'100.00',ConfirmedVol:'100.00',NAV:'1.00000000'}:{})}));
   const wire={creator:'27',receiver:'227',date:'20260818',version:'22',fileType:type,sequence:801};
   const parsed=await parsing.parse(token,{...scope,batchPublicId,expectedType:type,exchangeStepId:step.stepId,files:[{fileName:dataFileName(wire),base64:buildDataFile({...wire,records}).toString('base64')}]});
   assert.equal(parsed.phase,'PARSED');
   const beforeApply=await confirmations.salesData(token);assert.equal(type==='02'?beforeApply.accounts.length:beforeApply.holdings.length,0);
   const apply={...scope,parseId:parsed.parseId,recordIndexes:rows.map((_,i)=>i),exchangeStepId:step.stepId};
   await confirmations.apply(token,apply);const applied=await confirmations.salesData(token);
   await confirmations.apply(token,apply);assert.deepEqual(await confirmations.salesData(token),applied);
  }
  const sales=await confirmations.salesData(token);assert.equal(sales.accounts.length,count);assert.equal(sales.holdings.length,count);assert.equal(sales.transactions.length,count);assert.ok(sales.holdings.every(h=>h.totalVolume==='100.00'));
  const afterApps=(await exchange.listCaseApplications(token,scope)).applications;
  assert.ok(afterApps.filter(a=>a.fileType==='03').every(a=>!a.record.TAAccountID));
  const resultRepository=createCaseResultRepository({transaction});
  let compared;
  if(live&&process.env.CASE_AGENT_FLOW_REAL_REVIEW==='1'){
   const apiKey=execFileSync('security',['find-generic-password','-s','codex.sophnet.ta-case-test-agent','-a','api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
   assert.ok(apiKey);
   const content=JSON.stringify({source:'合成02/04回传本地演练，未向外部TA投递',openingCount:sales.accounts.length,purchaseCount:sales.transactions.length,
     applicationStatuses:afterApps.map(a=>({businessCode:a.businessCode,transactionAccountId:a.record.TransactionAccountID,status:a.status})),
     confirmedTransactions:sales.transactions.map(t=>({transactionAccountId:t.transactionAccountId,confirmedAmount:t.confirmedAmount,confirmedVolume:t.confirmedVolume}))});
   await resultRepository.saveBusinessOutput(token,{...scope,requestId:crypto.randomUUID(),planVersion:1,sourceKind:'SYNTHETIC_TEST',content});
   const snapshot=await resultRepository.snapshot(token,scope);
   const provider=createSophnetCompletion({apiKey,maxTokens:8192});
   const complete=async request=>{const raw=await provider(request);if(process.env.DELIVERY_ARTIFACT_DIRECTORY){mkdirSync(process.env.DELIVERY_ARTIFACT_DIRECTORY,{recursive:true});writeFileSync(join(process.env.DELIVERY_ARTIFACT_DIRECTORY,'business-review-raw.json'),raw);}return raw;};
   const state=await createCaseResultGraph({collect:async()=>snapshot,complete}).invoke({});
   compared=state.suggestion;
  }else compared=compareConfirmedExpectations(await resultRepository.snapshot(token,scope));
  assert.equal(compared.outcome,'PASS',JSON.stringify(compared));assert.ok(compared.checks.length>=2*count);
  const retry=await project.prepare({token,...scope,channelId});assert.deepEqual(retry.files.map(f=>f.id),result.files.map(f=>f.id));
  assert.deepEqual((await exchange.readDeliveryPackage(token,{chatPublicId:scope.chatPublicId,batchPublicId})).rawBytes,zip.rawBytes);
  if(count===10&&process.env.DELIVERY_ARTIFACT_DIRECTORY){mkdirSync(process.env.DELIVERY_ARTIFACT_DIRECTORY,{recursive:true});writeFileSync(join(process.env.DELIVERY_ARTIFACT_DIRECTORY,zip.fileName),zip.rawBytes);writeFileSync(join(process.env.DELIVERY_ARTIFACT_DIRECTORY,'flow-report.json'),JSON.stringify({modelGenerated:!!live,syntheticReceipts:true,externalTaSubmitted:false,accounts:count,files:zip.manifest,checks:compared.checks.length,outcome:compared.outcome},null,2));}
 }finally{await db.rollback();await db.end();}
});
