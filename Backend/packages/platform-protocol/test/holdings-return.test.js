import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataFile } from '../src/index.js';
import { parseReturnFiles } from '../src/return-parsing.js';
import { planHoldingsSync,volumeUnits,volumeText } from '../src/holdings-return.js';
const channel={taCode:'27',distributorCode:'306',protocolVersion:'22'};
const record={AvailableVol:'120.00',TotalVolOfDistributorInTA:'150.00',TotalFrozenVol:'30.00',TransactionCfmDate:'20261007',
  FundCode:'000001',TransactionAccountID:'TRADE001',TAAccountID:'TA001',DistributorCode:'306',BranchCode:'306',ShareClass:'0',DetailFlag:'0',WholeFlag:'0'};
function pack(records,version='22') {
 const raw=buildDataFile({creator:'27',receiver:'306',date:'20261007',fileType:'05',version,records});
 return parseReturnFiles([{fileName:'OFD_27_306_20261007_05.TXT',base64:raw.toString('base64')}],{expectedType:'05',channel:{...channel,protocolVersion:version}}).result;
}
test('05 21/22 totals are absolute balances for incremental transmission; detail and fund totals excluded',()=>{
 for(const version of ['21','22']){
  const rows=planHoldingsSync(pack([record,{...record,DetailFlag:'1'},{...record,DetailFlag:'A',TransactionAccountID:null,TAAccountID:null,DistributorCode:null,BranchCode:null}],version),channel);
  assert.equal(rows[0].total,'150.00');assert.equal(rows[0].status,'READY');
  assert.deepEqual(rows.slice(1).map(r=>r.status),['DETAIL_ONLY','FUND_SUMMARY_ONLY']);
 }
 assert.equal(planHoldingsSync(pack([{...record,TotalVolOfDistributorInTA:'0.00',AvailableVol:'0.00',TotalFrozenVol:'0.00'}]),channel)[0].total,'0.00');
});
test('05 invalid amounts, flags, dates, channel and duplicate keys rejected',()=>{
 for(const patch of [{AvailableVol:'151.00'},{TotalFrozenVol:'31.00'},{WholeFlag:'9'},{DetailFlag:'2'},
  {TransactionCfmDate:'20260230'},{TransactionCfmDate:'20261008'},{DistributorCode:'307'},{TransactionAccountID:null}])
  assert.throws(()=>planHoldingsSync(pack([{...record,...patch}]),channel));
 assert.throws(()=>planHoldingsSync(pack([record,record]),channel),{code:'DUPLICATE_HOLDING_BALANCE'});
});
test('holdings arithmetic exact above floating point precision; overflow rejected',()=>{
 assert.equal(volumeText(volumeUnits('90071992547409.91')+1n),'90071992547409.92');
 assert.throws(()=>volumeText(volumeUnits('99999999999999.99')+1n),{code:'HOLDING_VOLUME_OVERFLOW'});
});
