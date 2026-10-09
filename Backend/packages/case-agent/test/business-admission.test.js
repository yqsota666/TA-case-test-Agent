import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMISSION_PROMPT_VERSION,createBusinessAdmission,parseAdmission} from '../src/business-admission.js';
import {createPersistedDiscussionService} from '../src/persisted-discussion.js';

test('rejected and uncertain material never creates a discussion turn or calls the main model',async()=>{
  for(const decision of ['REJECT','CLARIFY']) {
    let writes=0,mainCalls=0;
    const admissionRepo={context:async()=>({case:'测试文件导入'}),claim:async()=>({lease:'x'}),finish:async()=>{},release:async()=>{}};
    const admit=createBusinessAdmission({repository:admissionRepo,complete:async()=>JSON.stringify({decision})});
    const repository={readCaseDiscussion:async()=>({revision:0,turns:[]}),beginCaseDiscussionTurn:async()=>{writes++;},
      finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
    const service=createPersistedDiscussionService({repository,admit,complete:async()=>{mainCalls++;}});
    await assert.rejects(service.discuss({token:'session',chatPublicId:'chat',casePublicId:'case',userInput:'帮我写首诗'}),{status:422});
    assert.equal(writes,0);assert.equal(mainCalls,0);
  }
});

test('malformed classifier output fails closed and releases only its own lease',async()=>{
  let released;
  const repository={context:async()=>({}),claim:async()=>({lease:'mine'}),finish:async()=>assert.fail(),release:async(...args)=>{released=args.at(-1);}};
  const admit=createBusinessAdmission({repository,complete:async()=>'{"decision":"ALLOW","override":true}'});
  await assert.rejects(admit({text:'测试开户',token:'t',chatPublicId:'c',casePublicId:'k'}),{code:'ADMISSION_UNAVAILABLE'});
  assert.equal(released,'mine');
  for(const text of ['ALLOW','null','[]','{"decision":"UNKNOWN"}'])assert.throws(()=>parseAdmission(text));
});

test('cached rejection avoids another paid call; context revision changes the cache key',async()=>{
  let revision=1,calls=0;const hashes=[];
  const repository={context:async()=>({revision}),claim:async(t,c,k,hash)=>{hashes.push(hash);return {result:{decision:'REJECT'}};}};
  const admit=createBusinessAdmission({repository,complete:async()=>{calls++;}});
  for(let i=0;i<2;i++)await assert.rejects(admit({text:'无关',token:'t',chatPublicId:'c',casePublicId:'k'}));
  revision++;
  await assert.rejects(admit({text:'无关',token:'t',chatPublicId:'c',casePublicId:'k'}));
  assert.equal(calls,0);assert.equal(hashes[0],hashes[1]);assert.notEqual(hashes[1],hashes[2]);
});

test('image analysis is screened before persistence and never leaks into main context on rejection',async()=>{
  let seen,writes=0;
  const images=[{name:'sample.png',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
  const repository={readCaseDiscussion:async()=>({revision:0,turns:[]}),beginCaseDiscussionTurn:async()=>{writes++;},
    finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
  const service=createPersistedDiscussionService({repository,complete:async()=>assert.fail(),visionComplete:async()=> '一张猫的照片',
    admit:async({text})=>{seen=text;throw Object.assign(new Error('unrelated'),{status:422});}});
  await assert.rejects(service.discuss({userInput:'',images}));
  assert.match(seen,/猫/);assert.equal(writes,0);
});


test('recommendation requests reach discussion with the preceding assistant question in admission context',async()=>{
 const context={case:'状态转换测试',recentConversation:[{role:'user',revision:1,content:'测试边界及失败重试'},
  {role:'assistant',revision:1,content:'可以比较不同初始状态，你希望采用哪组条件？'}]};
 let classified,writes=0,mainCalls=0;
 const admissionRepository={context:async()=>context,claim:async()=>({lease:'mine'}),finish:async()=>{},release:async()=>{}};
 const admit=createBusinessAdmission({repository:admissionRepository,complete:async request=>{classified=JSON.parse(request.user);return '{"decision":"ALLOW"}';}});
 const history={revision:1,turns:context.recentConversation.map(({role,content})=>({role,content}))};
 const repository={readCaseDiscussion:async()=>history,beginCaseDiscussionTurn:async()=>{writes++;return {turnNumber:2};},
  finishCaseDiscussionTurn:async()=>({revision:2}),finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}};
 const service=createPersistedDiscussionService({repository,admit,complete:async()=>{mainCalls++;return '可以先采用初始状态一致、只改变目标状态的对照方案。尚未明确的重试间隔作为待采纳建议。下一步：讨论具体边界和预期。';}});
 const result=await service.discuss({token:'t',chatPublicId:'c',casePublicId:'k',userInput:'你可以推荐吗？帮我生成一版'});
 assert.deepEqual(classified.context.recentConversation,context.recentConversation);
 assert.equal(classified.material,'你可以推荐吗？帮我生成一版');assert.equal(writes,1);assert.equal(mainCalls,1);assert.match(result.reply,/对照方案/);
});

test('assistant context changes invalidate cached decisions, and the revised policy has a fresh cache namespace',async()=>{
 let answer='请提供准备条件';const hashes=[];
 const repository={context:async()=>({recentConversation:[{role:'assistant',revision:1,content:answer}]}),claim:async(t,c,k,hash)=>{hashes.push(hash);return {result:{decision:'ALLOW'}};}};
 const admit=createBusinessAdmission({repository,complete:async()=>assert.fail('cache should be reused')});
 const input={token:'t',chatPublicId:'c',casePublicId:'k',text:'帮我推荐'};
 await admit(input);await admit(input);answer='这里有两种业务方案，你想采用哪一个？';await admit(input);
 assert.equal(hashes[0],hashes[1]);assert.notEqual(hashes[1],hashes[2]);assert.equal(ADMISSION_PROMPT_VERSION,'business-admission-context-v2');
});


test('unclassified provider failures become a retryable admission error and release the lease before any discussion write',async()=>{
 const {createSophnetCompletion}=await import('../src/sophnet.js');
 let releases=0,writes=0;
 const complete=createSophnetCompletion({client:{chat:{completions:{create:async()=>{throw new SyntaxError('private upstream payload');}}}}});
 const admit=createBusinessAdmission({repository:{context:async()=>({}),claim:async()=>({lease:'mine'}),finish:async()=>assert.fail('must not cache failure'),release:async()=>{releases++;}},complete});
 const service=createPersistedDiscussionService({repository:{readCaseDiscussion:async()=>({turns:[],revision:0}),beginCaseDiscussionTurn:async()=>{writes++;},finishCaseDiscussionTurn:async()=>{},finishCasePlanProposal:async()=>{},abandonCaseDiscussionTurn:async()=>{}},complete:async()=>assert.fail('main model must not run'),admit});
 await assert.rejects(service.discuss({token:'t',chatPublicId:'c',casePublicId:'k',userInput:'帮我整理方案'}),error=>error.code==='ADMISSION_UNAVAILABLE'&&error.status===503&&!error.message.includes('private'));
 assert.equal(releases,1);assert.equal(writes,0);
});
