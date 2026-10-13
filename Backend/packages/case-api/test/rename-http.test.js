import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createCaseHttpServer} from '../src/http.js';

test('rename endpoints require session, same origin and a title-only JSON body',async t=>{
  const calls=[],chatId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',caseId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const origin='http://127.0.0.1:3133';
  const server=createCaseHttpServer({allowedOrigin:origin,
    repository:{renameChat:async(...args)=>{calls.push(args);return {title:args.at(-1)};},renameCase:async(...args)=>{calls.push(args);return {title:args.at(-1)};}},
    discussionService:{},confirmPlan:()=>{},executeData:()=>{},reviseData:()=>{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}/api/chats/${chatId}`;
  const send=(suffix,headers={},body={title:'新名称'})=>fetch(base+suffix,{method:'POST',headers:{cookie:'case_session=synthetic',origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  for(const suffix of ['/rename',`/cases/${caseId}/rename`]){
    assert.equal((await send(suffix,{cookie:''})).status,401);
    assert.equal((await send(suffix,{origin:'https://foreign.invalid'})).status,403);
    assert.equal((await send(suffix,{'content-type':'text/plain'})).status,415);
    assert.equal((await send(suffix,{}, {title:'新名称',workspaceId:1})).status,400);
    assert.equal((await send(suffix,{},null)).status,400);
    assert.equal((await send(suffix)).status,200);
  }
  assert.deepEqual(calls,[['synthetic',chatId,'新名称'],['synthetic',chatId,caseId,'新名称']]);
});
