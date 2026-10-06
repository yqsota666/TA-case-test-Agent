import {createTaResetRepository,assertTaAccountActive} from '../src/ta-reset.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrationConfig } from '../src/migrate.js';
import { createCaseRepository } from '../src/index.js';
import { createExchangeRepository } from '../src/exchange.js';
import { createReturnParsingRepository } from '../src/return-parsing.js';
import { createExchangePlanSupplementRepository } from '../src/exchange-plan-supplement.js';
import { createReturnConfirmationRepository } from '../src/return-confirmation.js';
import { createReturnParsingService } from '../../case-api/src/return-parsing.js';
import { createReturnConfirmationService } from '../../case-api/src/return-confirmation.js';
import { createDataGenerationGraph } from '../../case-agent/src/data-generation.js';
import { verifyExchangeOrderRace } from './helpers/exchange-order-race.js';
import { verifyAccountSelectionRace } from './helpers/account-selection-race.js';
import { buildDataFile, dataFileName } from '../../platform-protocol/src/index.js';

import {verifyHoldingsSync} from './helpers/holdings-sync.js';

const jsonValue=value=>typeof value==='string'?JSON.parse(value):value;

// Opt-in against a migrated MySQL database. Every fixture and business write is rolled back.
test('MySQL: draft -> delivered 01 -> confirmed 02 -> delivered 03 -> confirmed 04, isolated and atomic',
  { skip: process.env.CASE_CONFIRMATION_MYSQL !== '1' }, async () => {
  const db = await mysql.createConnection(migrationConfig());
  const token = crypto.randomBytes(32).toString('base64url');
  let savepoint = 0;
  try {
    await db.beginTransaction();
    const suffix = crypto.randomUUID();
    const [user] = await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name)
      VALUES (?,?,?,'确认账本测试')`, [suffix,suffix+'@example.invalid','synthetic-test-only']);
    const [workspace] = await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
    const workspaceId = workspace.insertId;
    await db.execute(`INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))`,
      [crypto.createHash('sha256').update(token).digest('hex'),user.insertId]);
    const [channel] = await db.execute(`INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version)
      VALUES (?,'synthetic','synthetic','27','306','22')`,[workspaceId]);
    const channelId = String(channel.insertId);
    const transaction = async action => {
      const name = 'confirmation_'+(++savepoint);
      await db.query('SAVEPOINT '+name);
      try { return await action(db); } catch (error) { await db.query('ROLLBACK TO SAVEPOINT '+name); throw error; }
    };
    const repository = createCaseRepository({ transaction });
    const exchange = createExchangeRepository({ transaction });
    const parsing = createReturnParsingService({ repository: createReturnParsingRepository({ transaction }) });
    const supplements=createExchangePlanSupplementRepository({transaction});
    const confirmations = createReturnConfirmationService({ repository: createReturnConfirmationRepository({ transaction }) });
    const stepIds=new Map();
    const counters=new Map();
    const planStep=(stepId,fileType,roundId,dependsOn=[])=>({stepId,fileType,roundId,direction:['01','03'].includes(fileType)?'SEND':'RECEIVE',businessTime:{kind:'DATE',value:fileType==='01'?'20261006':'20261007'},required:true,dependsOn});
    async function createCase(withAccount = true, sharedChat = null) {
      const scope = { chatPublicId: sharedChat ?? crypto.randomUUID(),casePublicId: crypto.randomUUID() };
      let chat;
      if(sharedChat){const [[existing]]=await db.execute('SELECT id FROM case_chats WHERE workspace_id=? AND public_id=?',[workspaceId,sharedChat]);chat={insertId:existing.id};}
      else [chat] = await db.execute(`INSERT INTO case_chats(public_id,workspace_id,title) VALUES (?,?,'合成确认账本测试')`,[scope.chatPublicId,workspaceId]);
      const [c] = await db.execute(`INSERT INTO cases(public_id,workspace_id,chat_id,title,status) VALUES (?,?,?,'合成确认账本测试','SOP_LOCKED')`,[scope.casePublicId,workspaceId,chat.insertId]);
      await db.execute(`INSERT INTO case_sop_versions(workspace_id,chat_id,case_id,version_number,plan_json,status,locked_at)
        VALUES (?,?,?,1,?,'LOCKED',CURRENT_TIMESTAMP(3))`,[workspaceId,chat.insertId,c.insertId,JSON.stringify({test:'synthetic',exchangePlan:{status:'READY',openQuestions:[],steps:withAccount? [planStep('s01_1','01','open1'),planStep('r02_1','02','open1',[{stepId:'s01_1',condition:'SENT'}]),planStep('s03_1','03','trade1',[{stepId:'r02_1',condition:'CONFIRMED'}]),planStep('r04_1','04','trade1',[{stepId:'s03_1',condition:'SENT'}])] : [planStep('s03_1','03','trade1'),planStep('r04_1','04','trade1',[{stepId:'s03_1',condition:'SENT'}]),planStep('s03_2','03','trade2',[{stepId:'r04_1',condition:'CONFIRMED'}]),planStep('r04_2','04','trade2',[{stepId:'s03_2',condition:'SENT'}])]}})]);
      const spec = { customers: withAccount ? [{ name:'合成客户',investorType:'1',simulatedBalance:'999999.00' }] : [],
        accounts: withAccount ? [{ customerIndex:0,branchCode:'306' }] : [],
        funds:[{ fundCode:'000001',fundName:'合成基金',shareClass:'0',nav:'1.00000000' }],
        holdings: withAccount ? [{ accountIndex:0,fundIndex:0,totalVolume:'888.00000000' }] : [],missing:[] };
      await repository.executeGeneratedData(token,scope.chatPublicId,scope.casePublicId,1,spec,(conn,keys,data)=>
        createDataGenerationGraph({ db:conn,scope:keys,specification:data }).invoke({}));
      const data = await repository.confirmGeneratedData(token,scope.chatPublicId,scope.casePublicId,0);
      return { scope,data };
    }
    async function stage(scope,data,fileType,record) {
      return exchange.stageApplication(token,{ ...scope,sopVersionId:data.planVersionId,channelId,businessDate:record.TransactionDate,fileType,record });
    }
    async function generate(scope,record,app) {
      const batch = await exchange.createOutboundBatch(token,{ chatPublicId:scope.chatPublicId,channelId,
        businessDate:record.TransactionDate,applicationPublicIds:[app.publicId] });
      await exchange.generateOutboundFiles(token,{ chatPublicId:scope.chatPublicId,batchPublicId:batch.publicId });
      const type=record.BusinessCode==='001'?'01':'03';
      const key=scope.casePublicId+type; const n=(counters.get(key)??0)+1;counters.set(key,n);
      stepIds.set(batch.publicId,`s${type}_${n}`);
      return batch.publicId;
    }
    async function parse(scope,batchPublicId,fileType,records,sequence) {
      const options = { creator:'27',receiver:'306',date:'20261007',version:'22',fileType,sequence };
      const raw = buildDataFile({ ...options,records });
      return parsing.parse(token,{ ...scope,batchPublicId,expectedType:fileType,
        exchangeStepId:stepIds.get(batchPublicId).replace(/^s01/,'r02').replace(/^s03/,'r04'),files:[{ fileName:dataFileName(options),base64:raw.toString('base64') }] });
    }
    const first = await createCase();
    const opening = { AppSheetSerialNo:'SYNOPEN01',BusinessCode:'001',DistributorCode:'306',TransactionDate:'20261006',TransactionTime:'120000',
      TransactionAccountID:first.data.accounts[0].account_no,BranchCode:'306',InvestorName:'合成客户',IndividualOrInstitution:'1',CertificateType:'0',CertificateNo:'S'.repeat(40) };
    const trade = { AppSheetSerialNo:'SYNTRADE01',BusinessCode:'022',DistributorCode:'306',TransactionDate:'20261007',TransactionTime:'120000',
      TransactionAccountID:opening.TransactionAccountID,TAAccountID:'SYNTA01',BranchCode:'306',IndividualOrInstitution:'1',FundCode:'000001',ShareClass:'0',CurrencyType:'156',ApplicationAmount:'450.00',ChargeType:'0' };
    assert.deepEqual((await confirmations.salesData(token)).accounts,[]);
    assert.deepEqual((await confirmations.salesData(token)).holdings,[]); // 888 synthetic shares do not become sales holdings.
    await assert.rejects(stage(first.scope,first.data,'03',trade),{ code:'TA_ACCOUNT_UNVERIFIED' });
    const app01 = await stage(first.scope,first.data,'01',opening);
    const batch01 = await generate(first.scope,opening,app01);
    const return02 = { ...opening,BusinessCode:'101',ReturnCode:'0000',TAAccountID:'SYNTA01',TASerialNO:'SYNCFM01',TransactionCfmDate:'20261007' };
    const parsed02 = await parse(first.scope,batch01,'02',[return02],901);
    assert.equal(parsed02.result.businessApplied,false);
    assert.equal(parsed02.phase,'ORDER_REJECTED');assert.equal(parsed02.orderError.error,'ORDER_VIOLATION');
    const early=(await parsing.read(token,first.scope));assert.equal(early.steps[0].phase,'ORDER_REJECTED');
    assert.equal((await confirmations.salesData(token)).accounts.length,0);
    await assert.rejects(confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] }),{ code:'APPLICATION_NOT_DELIVERED' });
    await confirmations.delivery(token,{ ...first.scope,batchPublicId:batch01,exchangeStepId:stepIds.get(batch01) });
    await parse(first.scope,batch01,'02',[return02],901);
    await confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] });
    assert.equal((await confirmations.salesData(token)).accounts.length,1);
    assert.equal((await confirmations.salesData(token)).accounts[0].certificateNo.length,40);
    assert.equal((await exchange.listCaseBindings(token,first.scope)).bindings[0].taAccountId,'SYNTA01');
    assert.equal((await confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] })).results[0].duplicate,true);
    // An old locked business Plan is supplemented in place without rewriting its applications or drafts.
    const [[oldPlan]]=await db.execute(`SELECT s.id,s.workspace_id,s.chat_id,s.case_id,s.plan_json FROM case_sop_versions s JOIN cases k ON k.id=s.case_id AND k.workspace_id=s.workspace_id WHERE k.public_id=?`,[first.scope.casePublicId]);
    const oldKeys=[oldPlan.workspace_id,oldPlan.chat_id,oldPlan.case_id];
    const frozen=jsonValue(oldPlan.plan_json);const schedule=frozen.exchangePlan;delete frozen.exchangePlan;
    await db.execute('DELETE FROM case_exchange_plan_receipts WHERE workspace_id=? AND chat_id=? AND case_id=?',oldKeys);
    await db.execute('DELETE FROM case_exchange_plan_bindings WHERE workspace_id=? AND chat_id=? AND case_id=?',oldKeys);
    await db.execute('DELETE FROM case_exchange_plan_events WHERE workspace_id=? AND chat_id=? AND case_id=?',oldKeys);
    await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(frozen),oldPlan.id]);
    assert.equal((await parsing.read(token,first.scope)).exchangePlanStatus,'UNPLANNED');
    const supplemented=await supplements.confirm(token,{...first.scope,baseVersionNumber:1,exchangePlan:schedule,mappings:[
      {stepId:'s01_1',batchPublicId:batch01,parseIds:[]},{stepId:'r02_1',batchPublicId:batch01,parseIds:[parsed02.parseId]}]});
    assert.equal(supplemented.versionNumber,2);
    const latest=await repository.getLatestSopProposal(token,first.scope.chatPublicId,first.scope.casePublicId);
    const {exchangePlan:ignored,...business}=latest.proposal;assert.deepEqual(business,frozen);
    assert.equal((await repository.generatedData(token,first.scope.chatPublicId,first.scope.casePublicId)).planVersionId,String(oldPlan.id));
    const [[appPlan]]=await db.execute('SELECT sop_version_id FROM applications WHERE public_id=?',[app01.publicId]);assert.equal(String(appPlan.sop_version_id),String(oldPlan.id));
    assert.equal((await confirmations.apply(token,{...first.scope,parseId:parsed02.parseId,recordIndexes:[0]})).results[0].duplicate,true);
    await assert.rejects(supplements.confirm(token,{...first.scope,baseVersionNumber:2,exchangePlan:schedule,mappings:[]}),{code:'EXCHANGE_PLAN_ALREADY_DEFINED'});
    const app03 = await stage(first.scope,first.data,'03',trade);
    const batch03 = await generate(first.scope,trade,app03);
    const returned04 = { ...trade,BusinessCode:'122',ReturnCode:'0000',TASerialNO:'SYNCFM03',TransactionCfmDate:'20261007',
      ConfirmedAmount:'250.00',ConfirmedVol:'200.00',NAV:'1.25000000',BusinessFinishFlag:'1' };
    const parsed04 = await parse(first.scope,batch03,'04',[returned04],902);
    assert.equal((await confirmations.salesData(token)).transactions.length,0);
    await confirmations.delivery(token,{ ...first.scope,batchPublicId:batch03,exchangeStepId:stepIds.get(batch03) });
    await parse(first.scope,batch03,'04',[returned04],902);
    await confirmations.apply(token,{ ...first.scope,parseId:parsed04.parseId,recordIndexes:[0] });
    let sales = await confirmations.salesData(token);
    assert.equal(sales.transactions[0].confirmedAmount,'250.00');
    assert.equal(sales.holdings[0].totalVolume,'200.00');
    await confirmations.apply(token,{ ...first.scope,parseId:parsed04.parseId,recordIndexes:[0] });
    assert.deepEqual(await confirmations.salesData(token),sales);
    const changed = await parse(first.scope,batch03,'04',[{ ...returned04,ConfirmedVol:'201.00' }],903);
    await assert.rejects(confirmations.apply(token,{ ...first.scope,parseId:changed.parseId,recordIndexes:[0] }),{ code:'CONFIRMATION_CONFLICT' });
    assert.deepEqual(await confirmations.salesData(token),sales);
    const second = await createCase();
    const failedOpening = { ...opening,AppSheetSerialNo:'SYNOPEN02',TransactionAccountID:second.data.accounts[0].account_no };
    const failedApp = await stage(second.scope,second.data,'01',failedOpening);
    const failedBatch = await generate(second.scope,failedOpening,failedApp);
    const failed02 = await parse(second.scope,failedBatch,'02',[{ ...failedOpening,BusinessCode:'101',ReturnCode:'1001',TransactionCfmDate:'20261007' }],904);
    await confirmations.delivery(token,{ ...second.scope,batchPublicId:failedBatch,exchangeStepId:stepIds.get(failedBatch) });
    await parse(second.scope,failedBatch,'02',[{ ...failedOpening,BusinessCode:'101',ReturnCode:'1001',TransactionCfmDate:'20261007' }],904);
    const failed = await confirmations.apply(token,{ ...second.scope,parseId:failed02.parseId,recordIndexes:[0] });
    assert.equal(failed.results[0].outcome,'FAILED');
    assert.deepEqual(await confirmations.salesData(token),sales);
    assert.equal((await exchange.listCaseBindings(token,second.scope)).bindings.length,0);
    await assert.rejects(confirmations.apply(token,{ ...second.scope,parseId:parsed04.parseId,recordIndexes:[0] }),{ code:'PARSE_NOT_FOUND' });
    const reuse = await createCase(false);
    await confirmations.selectAccount(token,{ ...reuse.scope,accountPublicId:sales.accounts[0].publicId });
    const reuseData = await confirmations.applicationData(token,reuse.scope,reuse.data);
    assert.equal(reuseData.accounts.length,1);
    assert.equal(reuseData.accounts[0].account_no,opening.TransactionAccountID);
    assert.equal((await exchange.listCaseBindings(token,reuse.scope)).bindings.length,1);
    const direct03 = { ...trade,AppSheetSerialNo:'SYNDIRECT03' };
    const reusedApp = await stage(reuse.scope,reuseData,'03',direct03);
    const reusedBatch = await generate(reuse.scope,direct03,reusedApp);
    assert.deepEqual((await parsing.read(token,reuse.scope)).steps.map(row=>row.expectedType),['04']);
    const direct04 = await parse(reuse.scope,reusedBatch,'04',[{ ...returned04,AppSheetSerialNo:'SYNDIRECT03' },
      { ...returned04,AppSheetSerialNo:'UNKNOWNTEST' }],905);
    await confirmations.delivery(token,{ ...reuse.scope,batchPublicId:reusedBatch,exchangeStepId:stepIds.get(reusedBatch) });
    await parse(reuse.scope,reusedBatch,'04',[{...returned04,AppSheetSerialNo:'SYNDIRECT03'},{...returned04,AppSheetSerialNo:'UNKNOWNTEST'}],905);
    await assert.rejects(confirmations.apply(token,{ ...reuse.scope,parseId:direct04.parseId,recordIndexes:[0,1] }),{ code:'RETURN_MISMATCH' });
    assert.deepEqual(await confirmations.salesData(token),sales);
    assert.equal((await exchange.listCaseApplications(token,reuse.scope)).applications[0].status,'WAITING_RETURN');
    // A fault after confirmation+transaction inserts must roll back the entire business operation.
    const failingRepo = createReturnConfirmationRepository({ transaction: action => transaction(() => action({
      execute: (sql,values) => {
        if (sql.startsWith('INSERT INTO sales_confirmed_holdings')) throw Object.assign(new Error('synthetic storage fault'),{ code:'ER_TEST_STORAGE_FAULT' });
        return db.execute(sql,values);
      },
    })) });
    const failingService = createReturnConfirmationService({ repository:failingRepo });
    await assert.rejects(failingService.apply(token,{ ...reuse.scope,parseId:direct04.parseId,recordIndexes:[0] }),{ code:'ER_TEST_STORAGE_FAULT' });
    assert.deepEqual(await confirmations.salesData(token),sales);
    assert.equal((await exchange.listCaseApplications(token,reuse.scope)).applications[0].status,'WAITING_RETURN');
    await confirmations.apply(token,{ ...reuse.scope,parseId:direct04.parseId,recordIndexes:[0] });
    sales = await confirmations.salesData(token);
    assert.equal(sales.holdings[0].totalVolume,'400.00');
    const failedTrade = { ...trade,AppSheetSerialNo:'SYNFAIL03' };
    const failedTradeApp = await stage(reuse.scope,reuseData,'03',failedTrade);
    const failedTradeBatch = await generate(reuse.scope,failedTrade,failedTradeApp);
    const failed04 = await parse(reuse.scope,failedTradeBatch,'04',[{ ...returned04,AppSheetSerialNo:'SYNFAIL03',ReturnCode:'1001',ConfirmedAmount:null,ConfirmedVol:null,NAV:null }],906);
    await confirmations.delivery(token,{ ...reuse.scope,batchPublicId:failedTradeBatch,exchangeStepId:stepIds.get(failedTradeBatch) });
    await parse(reuse.scope,failedTradeBatch,'04',[{ ...returned04,AppSheetSerialNo:'SYNFAIL03',ReturnCode:'1001',ConfirmedAmount:null,ConfirmedVol:null,NAV:null }],906);
    assert.equal((await confirmations.apply(token,{ ...reuse.scope,parseId:failed04.parseId,recordIndexes:[0] })).results[0].outcome,'FAILED');
    assert.deepEqual(await confirmations.salesData(token),sales);
    if (process.env.CASE_CONFIRMATION_RACE === '1') {
      assert.match(migrationConfig().database, /^ta_case_agent_testrace[a-f0-9]+$/);
      const racing = await createCase(false);
      await confirmations.selectAccount(token,{ ...racing.scope,accountPublicId:sales.accounts[0].publicId });
      await verifyAccountSelectionRace({db,token,scope:racing.scope,channelId,planVersionId:racing.data.planVersionId,
        accountPublicId:sales.accounts[0].publicId,trade});
      await db.beginTransaction();
    }
    // Multiple 04 packages for one receive step aggregate only after every application succeeds.
    const multipart=await createCase(false);
    await confirmations.selectAccount(token,{...multipart.scope,accountPublicId:sales.accounts[0].publicId});
    const multiData=await confirmations.applicationData(token,multipart.scope,multipart.data);
    const requests=[{...trade,AppSheetSerialNo:'MULTIPART1'},{...trade,AppSheetSerialNo:'MULTIPART2'}];
    const multiApps=[];for(const request of requests)multiApps.push(await stage(multipart.scope,multiData,'03',request));
    const multiBatch=await exchange.createOutboundBatch(token,{chatPublicId:multipart.scope.chatPublicId,channelId,businessDate:trade.TransactionDate,applicationPublicIds:multiApps.map(app=>app.publicId)});
    await exchange.generateOutboundFiles(token,{chatPublicId:multipart.scope.chatPublicId,batchPublicId:multiBatch.publicId});stepIds.set(multiBatch.publicId,'s03_1');
    await confirmations.delivery(token,{...multipart.scope,batchPublicId:multiBatch.publicId,exchangeStepId:'s03_1'});
    const multiRecords=requests.map((request,index)=>({...returned04,AppSheetSerialNo:request.AppSheetSerialNo,TASerialNO:'MULTICFM'+index,ConfirmedAmount:'120.00',ConfirmedVol:'100.00',NAV:'1.20000000'}));
    const multiParses=[];
    for(let index=0;index<2;index++) {
      const pkg=await parse(multipart.scope,multiBatch.publicId,'04',[multiRecords[index]],910+index);multiParses.push(pkg);
      assert.equal(pkg.phase,'PARSED');await confirmations.apply(token,{...multipart.scope,parseId:pkg.parseId,recordIndexes:[0]});
      const [[count]]=await db.execute(`SELECT COUNT(*) AS n FROM case_exchange_plan_events e JOIN cases k ON k.id=e.case_id AND k.workspace_id=e.workspace_id WHERE k.public_id=? AND e.step_id='r04_1' AND e.condition_name='CONFIRMED'`,[multipart.scope.casePublicId]);assert.equal(Number(count.n),index);
    }
    for(const pkg of multiParses)assert.equal((await confirmations.apply(token,{...multipart.scope,parseId:pkg.parseId,recordIndexes:[0]})).results[0].duplicate,true);
    const parsedMulti=await parsing.read(token,multipart.scope);assert.equal(parsedMulti.steps[0].parses.filter(pkg=>pkg.orderAccepted).length,2);
    const [[multiEvents]]=await db.execute(`SELECT COUNT(*) AS n FROM case_exchange_plan_receipts r JOIN cases k ON k.id=r.case_id AND k.workspace_id=r.workspace_id WHERE k.public_id=?`,[multipart.scope.casePublicId]);assert.equal(Number(multiEvents.n),2);
    const correction=await parse(multipart.scope,multiBatch.publicId,'04',[{...multiRecords[0],ConfirmedVol:'101.00'}],912);
    const beforeCorrection=await confirmations.salesData(token);
    await assert.rejects(confirmations.apply(token,{...multipart.scope,parseId:correction.parseId,recordIndexes:[0]}),{code:'CONFIRMATION_CONFLICT'});
    assert.deepEqual(await confirmations.salesData(token),beforeCorrection);

    if(process.env.CASE_EXCHANGE_RACE==='1') {
      await verifyExchangeOrderRace({db,token,scope:multipart.scope,batchPublicId:multiBatch.publicId});
      return;
    }

    // A legacy generated batch mixing two Cases and01/03 is recoverable and sent atomically.
    const mixedOpening=await createCase(true);
    const mixedTrade=await createCase(false,mixedOpening.scope.chatPublicId);
    await confirmations.selectAccount(token,{...mixedTrade.scope,accountPublicId:sales.accounts[0].publicId});
    const mixedTradeData=await confirmations.applicationData(token,mixedTrade.scope,mixedTrade.data);
    const mixed01={...opening,AppSheetSerialNo:'MIXEDOPEN',TransactionAccountID:mixedOpening.data.accounts[0].account_no,TransactionDate:'20261007'};
    const mixed03={...trade,AppSheetSerialNo:'MIXEDTRADE'};
    const mixedApps=[await stage(mixedOpening.scope,mixedOpening.data,'01',mixed01),await stage(mixedTrade.scope,mixedTradeData,'03',mixed03)];
    const mixedBatch=await exchange.createOutboundBatch(token,{chatPublicId:mixedOpening.scope.chatPublicId,channelId,businessDate:'20261007',applicationPublicIds:mixedApps.map(app=>app.publicId)});
    await exchange.generateOutboundFiles(token,{chatPublicId:mixedOpening.scope.chatPublicId,batchPublicId:mixedBatch.publicId});
    const [[mixedPlan]]=await db.execute(`SELECT s.id,s.plan_json FROM case_sop_versions s JOIN cases k ON k.id=s.case_id AND k.workspace_id=s.workspace_id WHERE k.public_id=?`,[mixedOpening.scope.casePublicId]);
    const mixedBusiness=jsonValue(mixedPlan.plan_json);const mixedSchedule=mixedBusiness.exchangePlan;delete mixedBusiness.exchangePlan;
    mixedSchedule.steps[0].businessTime.value='20261007';
    await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(mixedBusiness),mixedPlan.id]);
    await assert.rejects(confirmations.delivery(token,{...mixedOpening.scope,batchPublicId:mixedBatch.publicId}),{code:'EXCHANGE_PLAN_REQUIRED'});
    const [[notSent]]=await db.execute('SELECT status FROM exchange_batches WHERE public_id=?',[mixedBatch.publicId]);assert.equal(notSent.status,'GENERATED');
    await supplements.confirm(token,{...mixedOpening.scope,baseVersionNumber:1,exchangePlan:mixedSchedule,mappings:[{stepId:'s01_1',batchPublicId:mixedBatch.publicId,parseIds:[]}]});
    const sentMixed=await confirmations.delivery(token,{...mixedOpening.scope,batchPublicId:mixedBatch.publicId,exchangeSteps:[
      {casePublicId:mixedOpening.scope.casePublicId,fileType:'01',stepId:'s01_1'},{casePublicId:mixedTrade.scope.casePublicId,fileType:'03',stepId:'s03_1'}]});
    assert.equal(sentMixed.steps.length,2);assert.equal(sentMixed.delivered,true);
    const [[sentBoth]]=await db.execute(`SELECT COUNT(*) AS n FROM applications WHERE public_id IN (?,?) AND status='WAITING_RETURN'`,mixedApps.map(app=>app.publicId));assert.equal(Number(sentBoth.n),2);
    assert.equal((await confirmations.delivery(token,{...mixedOpening.scope,batchPublicId:mixedBatch.publicId})).duplicate,true);
    await verifyHoldingsSync({db,transaction,token,workspaceId,channelId,confirmations,trade,returned04,createCase,stage,generate,parse});
    const otherUserId = crypto.randomUUID();
    const [other] = await db.execute(`INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'隔离测试')`,
      [otherUserId,otherUserId+'@example.invalid','synthetic-test-only']);
    await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),other.insertId]);
    const foreignToken = crypto.randomBytes(32).toString('base64url');
    await db.execute(`INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))`,
      [crypto.createHash('sha256').update(foreignToken).digest('hex'),other.insertId]);
    assert.equal((await confirmations.salesData(foreignToken)).accounts.length,0);
    await assert.rejects(confirmations.apply(foreignToken,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] }),{ code:'CASE_NOT_FOUND' });
    await assert.rejects(confirmations.delivery(foreignToken,{ ...first.scope,batchPublicId:batch01 }),{ code:'CASE_NOT_FOUND' });
    await assert.rejects(repository.createCase(token,mixedOpening.scope.chatPublicId,'执行中不能普通追加'),{code:'CHAT_EXECUTION_STARTED'});
    const reset=createTaResetRepository({transaction});
    const resetInput={channelId,requestId:crypto.randomUUID(),reason:'合成TA已经清空',confirmation:'TA_RESET_CONFIRMED'};
    await assert.rejects(reset.confirm(token,resetInput),{code:'TA_RESET_ACTIVE_CHATS'});
    const beforeReset=await confirmations.salesData(token);
    const [[oldAccount]]=await db.execute('SELECT id FROM sales_confirmed_accounts WHERE workspace_id=? AND channel_id=? ORDER BY id LIMIT 1',[workspaceId,channelId]);
    await assertTaAccountActive(db,workspaceId,channelId,oldAccount.id);
    await db.execute("UPDATE case_chats SET status='FORCE_CLOSED',close_reason='合成重置前封存',closed_at=NOW() WHERE workspace_id=?",[workspaceId]);
    assert.equal((await reset.confirm(token,resetInput)).epoch,1);
    assert.equal((await reset.confirm(token,resetInput)).duplicate,true);
    await assert.rejects(reset.confirm(token,{...resetInput,reason:'变化'}),{code:'TA_RESET_REQUEST_CONFLICT'});
    await assert.rejects(reset.read(foreignToken,{channelId}),{code:'CHANNEL_NOT_FOUND'});
    await assert.rejects(assertTaAccountActive(db,workspaceId,channelId,oldAccount.id),{code:'TA_ACCOUNT_RESET'});
    const afterReset=await confirmations.salesData(token);
    assert.equal(afterReset.accounts.length,beforeReset.accounts.length);
    assert.ok(afterReset.accounts.filter(a=>a.channelId===channelId).every(a=>!Number(a.taBindingActive)));
    assert.deepEqual(afterReset.transactions,beforeReset.transactions);assert.deepEqual(afterReset.holdings,beforeReset.holdings);
    const [freshAccount]=await db.execute(`INSERT INTO sales_confirmed_accounts(public_id,workspace_id,channel_id,transaction_account_id,ta_account_id,investor_name,investor_type,certificate_type,certificate_no,branch_code,source_confirmation_id)
      SELECT ?,workspace_id,channel_id,'NEWRESET123456789','NEWTA123','重置后合成','0','0','SYNRESET','306',source_confirmation_id FROM sales_confirmed_accounts WHERE id=?`,[crypto.randomUUID(),oldAccount.id]);
    await assertTaAccountActive(db,workspaceId,channelId,freshAccount.insertId);
    assert.equal((await reset.read(token,{channelId})).epoch,1);

  } finally { await db.rollback(); await db.end(); }
});
