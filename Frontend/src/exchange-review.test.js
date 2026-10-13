import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeReviewRows} from './exchange-review.js';
test('return comparison retains global indexes across files and blocks unmatched or already applied records',()=>{
 const requests=[{AppSheetSerialNo:'A',TransactionAccountID:'a',FundCode:'f',ShareClass:'0',ApplicationAmount:'100'},{AppSheetSerialNo:'B',TransactionAccountID:'b'}];
 const result={files:[{records:[{...requests[0],ConfirmedAmount:'90',ReturnCode:'0000'}]},{records:[{...requests[1],ReturnCode:'1001'},{...requests[0],TransactionAccountID:'foreign'},{...requests[0],AppSheetSerialNo:'unknown'}]}]};
 const rows=exchangeReviewRows(result,requests,[{parseId:'7',recordIndex:1}],'7');
 assert.deepEqual(rows.map(r=>r.index),[0,1,2,3]);
 assert.deepEqual(rows.map(r=>r.matched),[true,true,false,false]);
 assert.deepEqual(rows.map(r=>r.applied),[false,true,false,false]);
 assert.equal(rows[0].request.ApplicationAmount,'100');assert.equal(rows[0].record.ConfirmedAmount,'90');
 assert.equal(exchangeReviewRows(result,requests,[{parseId:'8',recordIndex:0}],'7')[0].applied,false);
});
