import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrationConfig } from '../src/migrate.js';
import { createCaseRepository } from '../src/index.js';
import { createExchangeRepository } from '../src/exchange.js';
import { createReturnParsingRepository } from '../src/return-parsing.js';
import { createReturnConfirmationRepository } from '../src/return-confirmation.js';
import { createReturnParsingService } from '../../case-api/src/return-parsing.js';
import { createReturnConfirmationService } from '../../case-api/src/return-confirmation.js';
import { createDataGenerationGraph } from '../../case-agent/src/data-generation.js';
import { verifyAccountSelectionRace } from './helpers/account-selection-race.js';
import { buildDataFile, dataFileName } from '../../platform-protocol/src/index.js';

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
    const confirmations = createReturnConfirmationService({ repository: createReturnConfirmationRepository({ transaction }) });
    async function createCase(withAccount = true) {
      const scope = { chatPublicId: crypto.randomUUID(),casePublicId: crypto.randomUUID() };
      const [chat] = await db.execute(`INSERT INTO case_chats(public_id,workspace_id,title) VALUES (?,?,'合成确认账本测试')`,[scope.chatPublicId,workspaceId]);
      const [c] = await db.execute(`INSERT INTO cases(public_id,workspace_id,chat_id,title,status) VALUES (?,?,?,'合成确认账本测试','SOP_LOCKED')`,[scope.casePublicId,workspaceId,chat.insertId]);
      await db.execute(`INSERT INTO case_sop_versions(workspace_id,chat_id,case_id,version_number,plan_json,status,locked_at)
        VALUES (?,?,?,1,?,'LOCKED',CURRENT_TIMESTAMP(3))`,[workspaceId,chat.insertId,c.insertId,JSON.stringify({ test: 'synthetic' })]);
      const spec = { customers: withAccount ? [{ name:'合成客户',investorType:'1',simulatedBalance:'999999.00' }] : [],
        accounts: withAccount ? [{ customerIndex:0,branchCode:'306' }] : [],
        funds:[{ fundCode:'000001',fundName:'合成基金',shareClass:'A',nav:'1.00000000' }],
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
      return batch.publicId;
    }
    async function parse(scope,batchPublicId,fileType,records,sequence) {
      const options = { creator:'27',receiver:'306',date:'20261007',version:'22',fileType,sequence };
      const raw = buildDataFile({ ...options,records });
      return parsing.parse(token,{ ...scope,batchPublicId,expectedType:fileType,
        files:[{ fileName:dataFileName(options),base64:raw.toString('base64') }] });
    }
    const first = await createCase();
    const opening = { AppSheetSerialNo:'SYNOPEN01',BusinessCode:'001',DistributorCode:'306',TransactionDate:'20261006',TransactionTime:'120000',
      TransactionAccountID:first.data.accounts[0].account_no,BranchCode:'306',InvestorName:'合成客户',IndividualOrInstitution:'1',CertificateType:'0',CertificateNo:'S'.repeat(40) };
    const trade = { AppSheetSerialNo:'SYNTRADE01',BusinessCode:'022',DistributorCode:'306',TransactionDate:'20261006',TransactionTime:'120000',
      TransactionAccountID:opening.TransactionAccountID,TAAccountID:'SYNTA01',BranchCode:'306',IndividualOrInstitution:'1',FundCode:'000001',ShareClass:'A',CurrencyType:'156',ApplicationAmount:'450.00',ChargeType:'0' };
    assert.deepEqual((await confirmations.salesData(token)).accounts,[]);
    assert.deepEqual((await confirmations.salesData(token)).holdings,[]); // 888 synthetic shares do not become sales holdings.
    await assert.rejects(stage(first.scope,first.data,'03',trade),{ code:'TA_ACCOUNT_UNVERIFIED' });
    const app01 = await stage(first.scope,first.data,'01',opening);
    const batch01 = await generate(first.scope,opening,app01);
    const return02 = { ...opening,BusinessCode:'101',ReturnCode:'0000',TAAccountID:'SYNTA01',TASerialNO:'SYNCFM01',TransactionCfmDate:'20261007' };
    const parsed02 = await parse(first.scope,batch01,'02',[return02],901);
    assert.equal(parsed02.result.businessApplied,false);
    assert.equal((await confirmations.salesData(token)).accounts.length,0);
    await assert.rejects(confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] }),{ code:'APPLICATION_NOT_DELIVERED' });
    await confirmations.delivery(token,{ ...first.scope,batchPublicId:batch01 });
    await confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] });
    assert.equal((await confirmations.salesData(token)).accounts.length,1);
    assert.equal((await confirmations.salesData(token)).accounts[0].certificateNo.length,40);
    assert.equal((await exchange.listCaseBindings(token,first.scope)).bindings[0].taAccountId,'SYNTA01');
    assert.equal((await confirmations.apply(token,{ ...first.scope,parseId:parsed02.parseId,recordIndexes:[0] })).results[0].duplicate,true);
    const app03 = await stage(first.scope,first.data,'03',trade);
    const batch03 = await generate(first.scope,trade,app03);
    const returned04 = { ...trade,BusinessCode:'122',ReturnCode:'0000',TASerialNO:'SYNCFM03',TransactionCfmDate:'20261007',
      ConfirmedAmount:'250.00',ConfirmedVol:'200.00',NAV:'1.25000000',BusinessFinishFlag:'1' };
    const parsed04 = await parse(first.scope,batch03,'04',[returned04],902);
    assert.equal((await confirmations.salesData(token)).transactions.length,0);
    await confirmations.delivery(token,{ ...first.scope,batchPublicId:batch03 });
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
    await confirmations.delivery(token,{ ...second.scope,batchPublicId:failedBatch });
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
    await confirmations.delivery(token,{ ...reuse.scope,batchPublicId:reusedBatch });
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
    await confirmations.delivery(token,{ ...reuse.scope,batchPublicId:failedTradeBatch });
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
  } finally { await db.rollback(); await db.end(); }
});
