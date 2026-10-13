import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCase} from './live-case-api.js';
import {setAccountStorageOwner} from './account-storage.js';
test('business request carries its account and discards a reply after account changes',async t=>{
 const previousFetch=globalThis.fetch;const previousWindow=globalThis.window;
 t.after(()=>{globalThis.fetch=previousFetch;globalThis.window=previousWindow;setAccountStorageOwner(null);});
 globalThis.window={dispatchEvent(){}};let resolveResponse;
 globalThis.fetch=async(path,options)=>{assert.equal(options.headers['X-Case-Account'],'account-a');return new Promise(resolve=>{resolveResponse=resolve;});};
 setAccountStorageOwner('account-a');const pending=requestCase('/chats');
 setAccountStorageOwner('account-b');resolveResponse(new Response(JSON.stringify({chats:[{title:'其他账号'}]}),{status:200}));
 await assert.rejects(pending,{code:'ACCOUNT_CHANGED'});
});
test('server identity mismatch causes reauthentication rather than allowing stale actions',async t=>{
 const previousFetch=globalThis.fetch;const previousWindow=globalThis.window;
 t.after(()=>{globalThis.fetch=previousFetch;globalThis.window=previousWindow;setAccountStorageOwner(null);});
 let expired=0;globalThis.window={dispatchEvent(event){if(event.type==='case-session-expired')expired++;}};
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'ACCOUNT_CHANGED',message:'账户已切换，请重新连接'}),{status:409});
 setAccountStorageOwner('account-a');await assert.rejects(requestCase('/chats',{title:'不会创建'}),{code:'ACCOUNT_CHANGED'});assert.equal(expired,1);
});
