import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
let server,PlanDocument,ArtifactCard,RecordDetails;
before(async()=>{server=await createServer({server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});({PlanDocument}=await server.ssrLoadModule('/src/plan-document.jsx'));({ArtifactCard}=await server.ssrLoadModule('/src/assistant-ui/artifact-card.jsx'));({RecordDetails}=await server.ssrLoadModule('/src/assistant-ui/record-details.jsx'));});
after(async()=>{await server?.close();});
test('sectioned plans retain all user text and an approval outside the scrolling content',()=>{
 for(const count of [1,3,7]){
  const proposal={objective:'核对字段变化',preconditions:['共同条件'],scenarios:Array.from({length:count},(_,i)=>({title:'字段'+i,setup:'长条件'.repeat(100),action:'操作'+i,expected:'预期'+i,evidence:'依据'+i})),contract:{version:2,applications:[],dataSpecification:{customers:[],accounts:[],funds:[],holdings:[],missing:[]}},exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]}};
  const html=renderToStaticMarkup(React.createElement(PlanDocument,{proposal,dataApproval:React.createElement('footer',{},'确认准备数据')}));
  assert.equal((html.match(/role="tabpanel"/g)||[]).length,3);
  assert.ok(html.includes('长条件'.repeat(100)));assert.ok(html.includes('预期'+(count-1)));
  assert.ok(html.indexOf('<footer>')>html.lastIndexOf('</section>'));
 }
});
test('record details preserve zero and escape values; generated cards are disabled and announce busy state',()=>{
 const html=renderToStaticMarkup(React.createElement(RecordDetails,{items:[['金额',0],['说明','<内容>'],['空值',null]]}));
 assert.ok(html.includes('<dd>0</dd>'));assert.ok(html.includes('&lt;内容&gt;'));assert.ok(html.includes('<dd>—</dd>'));
 const card=renderToStaticMarkup(React.createElement(ArtifactCard,{title:'测试方案',generating:true}));
 assert.match(card,/disabled=""/);assert.match(card,/aria-busy="true"/);assert.ok(!card.includes('animate-pulse'));
});
