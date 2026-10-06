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
