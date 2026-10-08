import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordColumns} from './catalog-model.js';
test('column layout preserves arbitrary protocol fields and does not mutate server columns',()=>{
 const input=[{key:'project',label:'项目'},{key:'custom',label:'其他协议字段'},{key:'InvestorName',label:'投资人户名'},{key:'TransactionAccountID',label:'投资人基金交易账号'}];
 const result=recordColumns(input);
 assert.deepEqual(result.map(x=>x.key),['InvestorName','TransactionAccountID','custom','project']);
 assert.deepEqual(input.map(x=>x.key),['project','custom','InvestorName','TransactionAccountID']);
 assert.equal(result[1].numeric,false);
});
test('financial quantities align numerically but categories and identifying codes stay text',()=>{
 const result=recordColumns([{key:'share_class',label:'份额类别'},{key:'fund_code',label:'基金代码'},{key:'total_volume',label:'总份额'},{key:'nav',label:'单位净值'}]);
 assert.equal(result.find(x=>x.key==='share_class').numeric,false);
 assert.equal(result.find(x=>x.key==='fund_code').numeric,false);
 assert.equal(result.find(x=>x.key==='total_volume').numeric,true);
 assert.equal(result.find(x=>x.key==='nav').numeric,true);
 assert.deepEqual(recordColumns(),[]);
});
