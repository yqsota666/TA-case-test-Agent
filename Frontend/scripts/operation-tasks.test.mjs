import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {operationPlan} from '../../Backend/packages/case-agent/test/operation-chain-fixture.js';
import {editableOperationFields,operationTasks} from '../../Backend/packages/platform-protocol/src/operation-chain.js';
let server,component;
before(async()=>{server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});component=await server.ssrLoadModule('/src/operation-tasks.jsx');});
after(async()=>{await server?.close();});
const render=(proposal,props={})=>renderToStaticMarkup(React.createElement(component.OperationTasks,{proposal,...props}));
test('task lists preserve every account and operation across variable chain lengths',()=>{
  for(const accounts of [1,2,4])for(const rounds of [1,2,4]){
    const plan=operationPlan({accounts,rounds}),html=render(plan);
    assert.equal(component.taskRows(plan).length,accounts*(rounds+1));
    for(let i=0;i<accounts;i++)assert.ok(html.includes(`合成客户${i+1}`));
    assert.ok(html.includes('申购'));if(rounds>1)assert.ok(html.includes('赎回'));
    assert.ok(!html.includes('CONFIRMED'));assert.ok(!html.includes('trade_0_0'));
  }
});
test('real progress remains distinct from proposed expected success',()=>{
  const html=render(operationPlan(),{locked:true,progress:[{key:'open_0',state:'FAILED'},{key:'trade_0_0',state:'BLOCKED'}]});
  assert.ok(html.includes('业务确认失败'));assert.ok(html.includes('前序结果不满足条件'));
  assert.ok(!html.includes('业务确认成功'));
});
test('read-only, missing tasks, long content and hostile markup render without inventing operations',()=>{
  assert.ok(render({exchangePlan:{status:'NOT_REQUIRED'}}).includes('无需账户申请操作'));
  assert.ok(render({}).includes('尚未整理账户操作'));
  const plan=operationPlan();plan.contract.dataSpecification.customers[0].name='<script>x</script>'.repeat(20);
  const html=render(plan);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('missing required fields remain editable without exposing system-owned account values',()=>{
  const plan=operationPlan();delete plan.contract.applications[0].fields.CertificateNo;
  const fields=editableOperationFields(operationTasks(plan)[0]);
  assert.equal(fields.CertificateNo,'');assert.equal(fields.CertificateType,'0');assert.equal(fields.TransactionTime,'090000');
  assert.equal('TransactionAccountID' in fields,false);assert.equal('AppSheetSerialNo' in fields,false);
});
