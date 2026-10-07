import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
let server,component;
before(async()=>{server=await createServer({server:{middlewareMode:true},appType:'custom'});component=await server.ssrLoadModule('/src/plan-document.jsx');});
after(async()=>{await server?.close();});
const render=proposal=>renderToStaticMarkup(React.createElement(component.PlanDocument,{proposal}));
test('unrelated business plans preserve every scenario field and default to a list',()=>{
  for(const item of [
    {title:'重复开户',setup:'已有确认账户',action:'再次提交开户申请',expected:'拒绝重复开户',evidence:'业务返回码'},
    {title:'文件编码校验',setup:'含中文名称的原始文件',action:'导入并解析文件',expected:'字段完整解析且无乱码',evidence:'原始文件与解析记录'},
  ]) {
    const html=render({objective:'独立业务验证',scenarios:[item]});
    for(const value of Object.values(item))assert.ok(html.includes(value));
    assert.ok(!html.includes('<table'));assert.ok(!html.includes('持有期'));assert.ok(!html.includes('还需确认'));
  }
});
test('missing optional data does not invent exchange steps or questions',()=>{
  assert.doesNotThrow(()=>render({}));
  const html=render({objective:'只读核对',scenarios:[{title:'读取状态',expected:'返回当前状态'}]});
  assert.ok(!html.includes('文件交换安排'));assert.ok(!html.includes('<dt>操作'));
});
test('many items, long text, and markup-like data retain content safely',()=>{
  const scenarios=Array.from({length:100},(_,i)=>({title:`检查项目 ${i}`,setup:'a'.repeat(1200),action:'查看记录',expected:'<script>alert(1)</script>',evidence:'核对记录'}));
  const html=render({scenarios});
  assert.equal((html.match(/class="cw-plan-item"/g)||[]).length,100);
  assert.ok(html.includes('检查项目 99'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
  assert.ok(component.planSummary({scenarios}).includes('100 个测试项'));
});
test('ready and unplanned exchange plans retain dependencies and timing questions',()=>{
  const ready=render({exchangePlan:{status:'READY',steps:[{stepId:'receive',fileType:'02',direction:'RECEIVE',businessTime:{value:'用户确认的接收时间'},dependsOn:[{stepId:'send',condition:'SENT'}],required:false}]}});
  for(const value of ['02','接收','用户确认的接收时间','send / SENT','可选'])assert.ok(ready.includes(value));
  const waiting=render({exchangePlan:{status:'UNPLANNED',steps:[],openQuestions:['请确认接收时点']}});
  assert.ok(waiting.includes('请确认接收时点'));
});
