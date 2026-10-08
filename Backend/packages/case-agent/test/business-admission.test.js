import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessAdmission,parseAdmission} from '../src/business-admission.js';
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
