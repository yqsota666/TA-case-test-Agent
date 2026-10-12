import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
let server,PlanDocument;
before(async()=>{server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});({PlanDocument}=await server.ssrLoadModule('/src/plan-document.jsx'));});
after(async()=>{await server?.close();});
test('confirmation stays outside every collapsed section for different plan shapes',()=>{
 for(const count of [1,2,5]){
  const proposal={objective:'通用核对',scenarios:Array.from({length:count},(_,i)=>({title:'情况'+i,setup:'条件'.repeat(500),action:'改变字段',expected:'观察结果',evidence:'记录'})),contract:{version:2,applications:[],dataSpecification:{customers:[],accounts:[],funds:[],holdings:[],missing:[]}}};
  const html=renderToStaticMarkup(React.createElement(PlanDocument,{proposal,dataApproval:React.createElement('footer',{},React.createElement('button',{},'确认准备数据'))}));
  assert.ok(html.indexOf('<footer>')>html.lastIndexOf('</details>'));
  assert.ok(html.includes('确认准备数据'));assert.ok(html.includes('情况'+(count-1)));
 }
});
