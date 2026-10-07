import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAccountHttpHandler} from '../src/account-http.js';
import {createAccountAuth,accountCookie} from '../src/account-auth.js';
const token='a'.repeat(43);
test('account cookie is HttpOnly, same-site, and production-secure; logout expires it',()=>{
 assert.match(accountCookie(token,{secure:true}),/HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
 assert.match(accountCookie(null),/Max-Age=0$/);
});
test('account credentials reject unsupported and incomplete input before database use',async()=>{
 let calls=0;const auth=createAccountAuth({transaction:async()=>{calls++;}});
 for(const input of [{},{email:'a@b.test',password:'short'},{email:'invalid',password:'abcdefgh'},{email:'a@b.test',password:'abcdefgh',workspaceId:7}])await assert.rejects(auth.login(input),{status:400});
 await assert.rejects(auth.register({email:'a@b.test',password:'abcdefgh',name:''}),{status:400});
 assert.equal(calls,0);
});
test('HTTP auth refuses foreign-origin mutations and never returns token in JSON',async()=>{
 let calls=0;const user={id:'account-id',name:'用户',email:'user@example.test'};
 const auth={current:async supplied=>{assert.equal(supplied,token);return {user};},login:async()=>{calls++;return {token,user};},logout:async()=>({signedOut:true})};
 const handle=createAccountHttpHandler({accountAuth:auth,allowedOrigin:'https://agent.example',secureCookie:true});
 const server=createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 try {
  const bad=await fetch(url+'/api/auth/login',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);assert.equal(calls,0);
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{origin:'https://agent.example','content-type':'application/json'},body:'{}'});assert.equal(login.status,200);assert.deepEqual(await login.json(),{user});assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const me=await fetch(url+'/api/auth/me',{headers:{cookie:'case_session='+token}});assert.equal(me.status,200);assert.deepEqual(await me.json(),{user});
  const stale=await fetch(url+'/api/auth/logout',{method:'POST',headers:{origin:'https://agent.example','content-type':'application/json',cookie:'case_session='+token,'x-case-account':'other-user'},body:'{}'});assert.equal(stale.status,409);
  const logout=await fetch(url+'/api/auth/logout',{method:'POST',headers:{origin:'https://agent.example','content-type':'application/json',cookie:'case_session='+token},body:'{}'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
