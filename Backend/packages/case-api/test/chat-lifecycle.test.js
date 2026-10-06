import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCaseHttpServer} from '../src/http.js';

test('lifecycle HTTP validates origin, exact intent and authenticated Chat scope',async t=>{
 const calls=[];const server=createCaseHttpServer({repository:{},discussionService:{},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{},allowedOrigin:'http://127.0.0.1:5188',chatLifecycle:Object.fromEntries(['read','close','retest','newRun'].map(method=>[method,async(token,input)=>{calls.push({method,token,input});return {ok:true};}]))});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/lifecycle`;
 const send=(suffix,body,origin='http://127.0.0.1:5188',cookie='case_session=synthetic')=>fetch(url+suffix,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{headers:{cookie:'case_session=synthetic'}})).status,200);
 assert.equal((await send('/close',{mode:'FORCE',reason:'停止'},'https://evil.invalid')).status,403);
 assert.equal((await send('/close',{mode:'FORCE'})).status,400);
 assert.equal((await send('/close',{mode:'NORMAL',workspaceId:'wrong'})).status,400);
 assert.equal((await send('/close',{mode:'FORCE',reason:'停止'})).status,200);
 assert.equal((await send('/retest',{requestId:'x',casePublicId:'y',reason:'修复'})).status,200);
 assert.equal((await send('/new-run',{requestId:'x',reason:'新轮次',confirmPreserveFormalData:true})).status,200);
 assert.deepEqual(calls.map(c=>c.method),['read','close','retest','newRun']);
 assert.equal(calls[1].input.chatPublicId,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
});

test('sealed Case model endpoints fail before executing discussion or preparation',async t=>{
 let modelCalls=0,guards=0;
 const server=createCaseHttpServer({repository:{assertCaseWritable:async()=>{guards++;throw Object.assign(new Error('封存'),{status:409,code:'CASE_NOT_WRITABLE'});}},discussionService:{discuss:async()=>{modelCalls++;}},confirmPlan:()=>{},executeData:()=>{modelCalls++;},reviseData:()=>{modelCalls++;},applicationPreparation:{prepare:async()=>{modelCalls++;}},allowedOrigin:'http://127.0.0.1:5188'});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/`;
 for(const endpoint of ['discussion','plan','data/execute','data/review','application-preparation']){
  const response=await fetch(url+endpoint,{method:'POST',headers:{origin:'http://127.0.0.1:5188',cookie:'case_session=synthetic','content-type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.equal((await response.json()).error,'CASE_NOT_WRITABLE');
 }
 assert.equal(guards,5);assert.equal(modelCalls,0);
});

test('TA reset is an explicit scoped declaration and rejects payload drift',async t=>{
 const calls=[];const server=createCaseHttpServer({repository:{},discussionService:{},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{},allowedOrigin:'http://127.0.0.1:5188',taReset:{read:async(token,input)=>{calls.push(input);return {epoch:0};},confirm:async(token,input)=>{calls.push(input);return {physicalResetPerformedByPlatform:false};}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/exchange/channels/42/ta-reset`;
 const headers={origin:'http://127.0.0.1:5188',cookie:'case_session=synthetic','content-type':'application/json'};
 assert.equal((await fetch(url,{headers})).status,200);
 assert.equal((await fetch(url+'/confirm',{method:'POST',headers,body:JSON.stringify({reason:'已重置'})})).status,400);
 const response=await fetch(url+'/confirm',{method:'POST',headers,body:JSON.stringify({requestId:'id',reason:'已重置',confirmation:'TA_RESET_CONFIRMED'})});
 assert.equal(response.status,200);assert.equal((await response.json()).physicalResetPerformedByPlatform,false);assert.equal(calls[1].channelId,'42');
});


test('model timeout and format failures retain actionable codes and do not expose upstream details',async t=>{
 let failure=Object.assign(new Error('模型响应超时，请重试同一待完成回合'),{code:'MODEL_TIMEOUT',status:504});
 const server=createCaseHttpServer({repository:{},discussionService:{discuss:async()=>{throw failure;}},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{},allowedOrigin:'http://127.0.0.1:5188'});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/chats/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/cases/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/discussion`;
 const request=()=>fetch(url,{method:'POST',headers:{origin:'http://127.0.0.1:5188',cookie:'case_session=synthetic','content-type':'application/json'},body:JSON.stringify({userInput:'重试原输入'})});
 let response=await request();assert.equal(response.status,504);assert.equal((await response.json()).error,'MODEL_TIMEOUT');
 failure=Object.assign(new Error('sensitive output'),{code:'MODEL_OUTPUT_FORMAT'});
 response=await request();assert.equal(response.status,502);const result=await response.json();assert.equal(result.error,'MODEL_OUTPUT_FORMAT');assert.ok(!result.message.includes('sensitive'));
});
