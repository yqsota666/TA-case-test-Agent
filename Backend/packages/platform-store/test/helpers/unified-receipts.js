import assert from 'node:assert/strict';
import {createTaReceiptsRepository} from '../../src/ta-receipts.js';
import {createHoldingsReturnRepository} from '../../src/holdings-return.js';
import {buildDataFile,buildIndexFile,dataFileName} from '../../../platform-protocol/src/index.js';
export async function verifyUnifiedReceipts({db,transaction,token,channelId,scope,batch01,batch03,return02,returned04,confirmations}) {
 await db.query('SAVEPOINT unified_receipts_fixture');
 try {
  const unified=createTaReceiptsRepository({transaction});
  const holdings=createHoldingsReturnRepository({transaction});
  const [[row]]=await db.execute(`SELECT s.id,s.plan_json FROM case_sop_versions s JOIN cases k ON k.workspace_id=s.workspace_id AND k.chat_id=s.chat_id AND k.id=s.case_id WHERE k.public_id=? AND s.status='LOCKED' ORDER BY s.version_number DESC LIMIT 1`,[scope.casePublicId]);
  const plan=typeof row.plan_json==='string'?JSON.parse(row.plan_json):row.plan_json;
  plan.exchangePlan.steps.push({stepId:'unified05',roundId:'holding',direction:'RECEIVE',fileType:'05',required:true,businessTime:{kind:'DATE',value:'20261007'},dependsOn:[]});
  await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(plan),row.id]);
  const record05={TransactionAccountID:returned04.TransactionAccountID,TAAccountID:returned04.TAAccountID,DistributorCode:'306',BranchCode:'306',FundCode:'000001',ShareClass:'0',DetailFlag:'0',WholeFlag:'0',TransactionCfmDate:'20261007',TotalVolOfDistributorInTA:'200.00',AvailableVol:'170.00',TotalFrozenVol:'30.00'};
  const records=[return02,returned04,record05];
  const files=['02','04','05'].map((fileType,i)=>{const options={creator:'27',receiver:'306',date:'20261007',version:'22',fileType,sequence:880};return {fileName:dataFileName(options),base64:buildDataFile({...options,records:[records[i]]}).toString('base64')};});
  const foreignOptions={creator:'27',receiver:'306',date:'20261007',version:'22',fileType:'04',sequence:881};
  files.unshift({fileName:dataFileName(foreignOptions),base64:buildDataFile({...foreignOptions,records:[{...returned04,AppSheetSerialNo:'UNRELATEDCASE'}]}).toString('base64')});
  const index={fileName:'OFI_27_306_20261007.TXT',base64:buildIndexFile({creator:'27',receiver:'306',date:'20261007',version:'22',fileNames:files.map(f=>f.fileName)}).toString('base64')};
  const input={...scope,channelId,files:[index,...files],routes:[{fileType:'02',batchPublicId:batch01,exchangeStepId:'r02_1'},{fileType:'04',batchPublicId:batch03,exchangeStepId:'r04_1'},{fileType:'05',exchangeStepId:'unified05'}]};
  const before=await confirmations.salesData(token);
  const count=async()=>{const [[n]]=await db.execute('SELECT COUNT(*) AS n FROM case_return_parses');return Number(n.n);};
  const initial=await count();
  await assert.rejects(unified.parse(token,{...input,files:[index,...files.slice(0,2)]}),{code:'RETURN_INDEX_MISMATCH'});
  assert.equal(await count(),initial);
  // A late routing/order error rolls back earlier 02/04 parsing as part of the same transaction.
  await assert.rejects(unified.parse(token,{...input,routes:[...input.routes.slice(0,2),{fileType:'05',exchangeStepId:'absent'}]}),{code:'EXCHANGE_STEP_REQUIRED'});
  assert.equal(await count(),initial);
  assert.deepEqual(await confirmations.salesData(token),before);
  const result=await unified.parse(token,input);
  assert.deepEqual(result.results.map(r=>r.fileType),['02','04','05']);assert.equal(result.businessApplied,false);
  assert.deepEqual(await confirmations.salesData(token),before);
  for(const child of result.results) {
    assert.equal((child.result??child.parsed).index.fileNames.length,4);
    const table=child.fileType==='05'?'case_holdings_return_files':'case_return_parse_files';
    const [raw]=await db.execute(`SELECT file_name,raw_bytes FROM ${table} WHERE parse_id=?`,[child.parseId]);
    assert.equal(raw.length,5);
    for(const file of [index,...files])assert.equal(raw.find(f=>f.file_name===file.fileName).raw_bytes.toString('base64'),file.base64);
  }
  assert.ok((await unified.parse(token,{...input,files:[...files,index]})).results.every(r=>r.duplicate));
  const two=result.results.find(r=>r.fileType==='02');
  const [originalRows]=await db.execute('SELECT file_name,raw_bytes FROM case_return_parse_files WHERE parse_id=? ORDER BY file_name LIMIT 1',[two.parseId]);
  await db.execute('UPDATE case_return_parse_files SET raw_bytes=? WHERE parse_id=? AND file_name=?',[Buffer.from('tampered'),two.parseId,originalRows[0].file_name]);
  await assert.rejects(confirmations.apply(token,{...scope,parseId:two.parseId,recordIndexes:[0]}),{code:'RETURN_SOURCE_INVALID'});
  await db.execute('UPDATE case_return_parse_files SET raw_bytes=? WHERE parse_id=? AND file_name=?',[originalRows[0].raw_bytes,two.parseId,originalRows[0].file_name]);
  for(const child of result.results.filter(r=>r.fileType!=='05')) assert.equal((await confirmations.apply(token,{...scope,parseId:child.parseId,recordIndexes:[child.fileType==='04'?1:0]})).results[0].duplicate,true);
  const four=result.results.find(r=>r.fileType==='04');
  await assert.rejects(confirmations.apply(token,{...scope,parseId:four.parseId,recordIndexes:[0]}),{code:'RETURN_MISMATCH'});
  const five=result.results.find(r=>r.fileType==='05');
  assert.equal((await holdings.apply(token,{...scope,parseId:five.parseId,exchangeStepId:'unified05'})).businessApplied,true);
  assert.equal((await holdings.apply(token,{...scope,parseId:five.parseId,exchangeStepId:'unified05'})).duplicate,true);
  await assert.rejects(unified.parse(token,{...input,channelId:'99999999'}),{code:'CHANNEL_NOT_FOUND'});
  await assert.rejects(unified.read(token,{...scope,casePublicId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}),{code:'CASE_NOT_FOUND'});
 }finally {await db.query('ROLLBACK TO SAVEPOINT unified_receipts_fixture');}
}
