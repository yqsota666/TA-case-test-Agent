import test from 'node:test';
import assert from 'node:assert/strict';
import {plannedHoldingsSteps,holdingsParseForStep,holdingsReviewRows} from './holdings-review.js';
test('05 only appears for an explicitly planned receive step',()=>{
 assert.deepEqual(plannedHoldingsSteps({proposal:{exchangePlan:{steps:[{direction:'RECEIVE',fileType:'04'},{direction:'SEND',fileType:'05'}]}}}),[]);
 assert.equal(plannedHoldingsSteps({proposal:{exchangePlan:{steps:[{stepId:'balance',direction:'RECEIVE',fileType:'05'}]}}})[0].stepId,'balance');
});
test('parse history is bound to the exact current plan and step',()=>{
 const old={parseId:'1',receipts:[{stepId:'balance',planVersion:1}]};const current={parseId:'2',receipts:[{stepId:'balance',planVersion:2}]};
 assert.equal(holdingsParseForStep({planVersion:2,parses:[old,current]},{stepId:'balance'}),current);
 assert.equal(holdingsParseForStep({planVersion:2,parses:[old,current]},{stepId:'other'}),undefined);
});
test('balance comparison matches full scoped key and preserves unknown quantities',()=>{
 const record={TransactionAccountID:'a',TAAccountID:'ta',FundCode:'f',ShareClass:'0',DetailFlag:'0',AvailableVol:'90.00'};
 const entry={channelId:'7',parsed:{files:[{fileName:'balance.txt',fileType:'05',records:[record]}]}};
 const holdings=[{channelId:'8',transactionAccountId:'a',taAccountId:'ta',fundCode:'f',shareClass:'0',totalVolume:'999'}, {channelId:'7',transactionAccountId:'a',taAccountId:'ta',fundCode:'f',shareClass:'0',totalVolume:'100',availableVolume:null,frozenVolume:null}];
 const [row]=holdingsReviewRows(entry,holdings);assert.equal(row.current.totalVolume,'100');assert.equal(row.current.availableVolume,null);assert.equal(row.record.TotalFrozenVol,undefined);assert.equal(row.label,'待确认同步');
});
test('detail and fund summary records are not advertised as applied account balances',()=>{
 const entry={parsed:{files:[{fileType:'05',records:[{DetailFlag:'1'},{DetailFlag:'A'}]}]}};
 assert.deepEqual(holdingsReviewRows(entry).map(row=>row.label),['份额明细，不更新账户余额','基金汇总，不更新账户余额']);
});
