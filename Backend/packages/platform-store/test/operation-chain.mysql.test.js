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
import {createApplicationPreparationService} from '../../case-api/src/prepare-applications.js';
import {createReturnParsingService} from '../../case-api/src/return-parsing.js';
import {createReturnConfirmationService} from '../../case-api/src/return-confirmation.js';
import {createDataGenerationGraph} from '../../case-agent/src/data-generation.js';
import {operationPlan} from '../../case-agent/test/operation-chain-fixture.js';
import {operationSerial} from '../../case-agent/src/operation-chain-graph.js';
import {buildDataFile,dataFileName} from '../../platform-protocol/src/index.js';
import {createCaseResultRepository} from '../src/case-result.js';
import {compareConfirmedExpectations} from '../../case-agent/src/case-result-graph.js';
import {createHoldingsReturnRepository} from '../src/holdings-return.js';

test('MySQL: same-day account chains generate only eligible waves and apply redemption exactly once',
  {skip:process.env.CASE_CONFIRMATION_MYSQL!=='1'},async()=>{
  const db=await mysql.createConnection(migrationConfig());let n=0;
  const transaction=async fn=>{const savepoint='operation_'+ ++n;await db.query('SAVEPOINT '+savepoint);try{return await fn(db);}catch(e){await db.query('ROLLBACK TO SAVEPOINT '+savepoint);throw e;}};
  try{
    await db.beginTransaction();const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
    const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'操作链合成验收')",[id,id+'@example.invalid','synthetic']);
    const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),user.insertId]);
    await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
    const [channel]=await db.execute("INSERT INTO exchange_channels(workspace_id,channel_name,ta_environment,ta_code,distributor_code,protocol_version) VALUES (?,'操作链合成','synthetic','27','306','22')",[workspace.insertId]);
    const channelId=String(channel.insertId),repository=createCaseRepository({transaction}),exchange=createExchangeRepository({transaction});
    const preparations=createApplicationPreparationRepository({transaction});
    const confirmations=createReturnConfirmationService({repository:createReturnConfirmationRepository({transaction})});
    const parsing=createReturnParsingService({repository:createReturnParsingRepository({transaction})});
    const service=createApplicationPreparationService({repository,preparations,exchangeRepository:exchange,confirmedSales:confirmations,derive:()=>{throw new Error('locked execution must not replan with a model');}});
    const chat=await repository.createChat(token,'操作链合成验收'),item=await repository.createCase(token,chat.publicId,'同日开户申购赎回');
    const scope={chatPublicId:chat.publicId,casePublicId:item.publicId},args=[token,scope.chatPublicId,scope.casePublicId],plan=operationPlan();
    plan.exchangePlan.steps.push({stepId:'earlier_snapshot',roundId:'snapshot',direction:'RECEIVE',fileType:'05',businessTime:{kind:'DATE',value:'20261007'},required:false,dependsOn:[]});
    await repository.saveSopProposal(...args,plan);
    await repository.confirmSopProposal(...args,1,'DATA');await repository.confirmSopProposal(...args,1,'EXPECTATIONS');
    await repository.executeGeneratedData(...args,1,plan.contract.dataSpecification,(conn,keys,specification)=>createDataGenerationGraph({db:conn,scope:keys,specification}).invoke({}));
    const data=await repository.confirmGeneratedData(...args,0);
    for(const [round,send,receive,type,code] of [[0,'open','opened','02','101'],[1,'trade_0','returned_0','04','122'],[2,'trade_1','returned_1','04','124']]){
      const state=await service.prepare({token,...scope,channelId});
      const apps=(await exchange.listCaseApplications(token,scope)).applications;
      assert.equal(apps.length,2*(round+1));
      const active=apps.filter(a=>a.status==='GENERATED');assert.equal(active.length,2);
      assert.equal(new Set(active.map(a=>a.batchPublicId)).size,1);
      const batchPublicId=active[0].batchPublicId;
      if(round===1){
        const future={...active[0].record,BusinessCode:'024',ApplicationVol:'10.00',LargeRedemptionFlag:'0',TransactionTime:'110000',AppSheetSerialNo:operationSerial({...scope,channelId,key:'trade_1_0'})};
        await assert.rejects(exchange.stageApplication(token,{...scope,channelId,sopVersionId:data.planVersionId,businessDate:'20261008',fileType:'03',record:future}),{code:'OPERATION_NOT_READY'});
      }
      await confirmations.delivery(token,{...scope,batchPublicId,exchangeStepId:send});
      const records=active.map((a,i)=>({...a.record,BusinessCode:code,ReturnCode:'0000',TransactionCfmDate:'20261008',TAAccountID:a.record.TAAccountID??`SYNTA${i}`,TASerialNO:`SYN${round}${i}`,BusinessFinishFlag:'1',...(round?{ConfirmedVol:round===1?'100.00':'10.00',ConfirmedAmount:round===1?'100.00':'10.00',NAV:'1.00000000'}:{})}));
      const options={creator:'27',receiver:'306',date:'20261008',version:'22',fileType:type,sequence:801+round};
      const parsed=await parsing.parse(token,{...scope,batchPublicId,expectedType:type,exchangeStepId:receive,files:[{fileName:dataFileName(options),base64:buildDataFile({...options,records}).toString('base64')}]});
      assert.notEqual(parsed.phase,'ORDER_REJECTED');
      const afterParse=await service.prepare({token,...scope,channelId,revision:state.revision});
      assert.equal((await exchange.listCaseApplications(token,scope)).applications.length,2*(round+1));
      assert.equal(afterParse.phase,round===2?'GENERATED':'WAITING_TA');
      if(round===2){
        for(const shortage of ['total_volume=5.00','available_volume=5.00']){
          await db.execute(`UPDATE sales_confirmed_holdings SET ${shortage} WHERE workspace_id=?`,[workspace.insertId]);
          await assert.rejects(confirmations.apply(token,{...scope,parseId:parsed.parseId,recordIndexes:[0,1],exchangeStepId:receive}),{code:'HOLDING_VOLUME_INSUFFICIENT'});
          assert.equal((await confirmations.salesData(token)).transactions.length,2);
          assert.ok((await exchange.listCaseApplications(token,scope)).applications.filter(a=>a.businessCode==='024').every(a=>a.status==='WAITING_RETURN'));
          await db.execute('UPDATE sales_confirmed_holdings SET total_volume=100.00,available_volume=NULL WHERE workspace_id=?',[workspace.insertId]);
        }
      }
      await confirmations.apply(token,{...scope,parseId:parsed.parseId,recordIndexes:[0,1],exchangeStepId:receive});
      await confirmations.apply(token,{...scope,parseId:parsed.parseId,recordIndexes:[0,1],exchangeStepId:receive});
      if(round>0){const sales=await confirmations.salesData(token);assert.deepEqual(sales.holdings.map(h=>h.totalVolume),[round===1?'100.00':'90.00',round===1?'100.00':'90.00']);}
    }
    await service.prepare({token,...scope,channelId});
    assert.equal((await exchange.listCaseApplications(token,scope)).applications.length,6);
    const snapshot=await createCaseResultRepository({transaction}).snapshot(token,scope);
    const result=compareConfirmedExpectations(snapshot);assert.equal(result.outcome,'PASS');assert.equal(result.checks.length,6);
    assert.equal((await confirmations.salesData(token)).transactions.length,4);
    const sales=await confirmations.salesData(token),holdings=createHoldingsReturnRepository({transaction});
    const options={creator:'27',receiver:'306',date:'20261007',version:'22',fileType:'05',sequence:850};
    const records=sales.accounts.map(a=>({TransactionAccountID:a.transactionAccountId,TAAccountID:a.taAccountId,DistributorCode:'306',BranchCode:'306',FundCode:'000001',ShareClass:'0',DetailFlag:'0',WholeFlag:'0',TransactionCfmDate:'20261007',TotalVolOfDistributorInTA:'0.00',AvailableVol:'0.00',TotalFrozenVol:'0.00'}));
    const parsed=await holdings.parse(token,{...scope,channelId,exchangeStepId:'earlier_snapshot',files:[{fileName:dataFileName(options),base64:buildDataFile({...options,records}).toString('base64')}]});
    await holdings.apply(token,{...scope,parseId:parsed.parseId,exchangeStepId:'earlier_snapshot'});
    assert.deepEqual((await confirmations.salesData(token)).holdings.map(h=>h.totalVolume),['90.00','90.00']);
  }finally{await db.rollback();await db.end();}
});
