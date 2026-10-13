import test from 'node:test';
import assert from 'node:assert/strict';
import {revisePreparedPlanContent} from '../src/prepared-plan-content.js';
const proposal={objective:'字段变化对照',preconditions:[],scenarios:[{title:'字段调整',setup:'已有输入',action:'修改字段',expected:'输出按新规则变化',evidence:'用户补充结果'}],openQuestions:[],exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]}};
const data={customers:[],accounts:[],funds:[],holdings:[],missing:[]};
const current={versionNumber:3,status:'PENDING_CONFIRMATION',proposal:{...proposal,contract:{dataSpecification:data}}};
const body={versionNumber:3,proposal};
const args={token:'local',chatPublicId:'chat',casePublicId:'case',body};
test('manual edit is model-reviewed, preserves prepared data and writes a new unconfirmed guarded version',async()=>{
 const calls=[];let saved;
 const repository={getLatestSopProposal:async()=>current,readCaseDiscussion:async()=>({turns:[]}),saveSopProposal:async(...args)=>{saved=args;}};
 await revisePreparedPlanContent({...args,repository,complete:async input=>{calls.push(input);return JSON.stringify(calls.length===1?{questions:[]}:{assumptions:[],applications:[],expectations:[],missing:[]});}});
 assert.equal(calls.length,2);assert.deepEqual(saved.at(-1),{expectedVersion:3});
 assert.deepEqual(saved[3].contract.dataSpecification,data);assert.equal(saved[3].contract.version,2);
 assert.deepEqual(saved[3].contract.businessExpectations,[{scenarioIndex:0,expectedQuote:proposal.scenarios[0].expected}]);
});
test('locked or stale edits do not call a model or save; genuine review questions survive in draft',async()=>{
 for(const c of [{...current,status:'LOCKED'},{...current,versionNumber:4}])await assert.rejects(revisePreparedPlanContent({...args,repository:{getLatestSopProposal:async()=>c},complete:()=>{throw Error('must not call');}}),{code:'STALE_PLAN'});
 let saved,calls=0;
 await revisePreparedPlanContent({...args,repository:{getLatestSopProposal:async()=>current,readCaseDiscussion:async()=>({turns:[]}),saveSopProposal:async(...args)=>{saved=args[3];}},complete:async()=>JSON.stringify(++calls===1?{questions:['两项规则互相矛盾，请选择保留哪项。']}:{assumptions:[],applications:[],expectations:[],missing:[]})});
 assert.equal(saved.openQuestions.length,1);
});


test('expectation-only edits retain exact preparation definitions; input edits still rebuild them',async()=>{
 const contract={version:2,protocolVersion:'22',dataSpecification:data,applications:[],assumptions:['原合成业务假设'],expectations:[],businessExpectations:[{scenarioIndex:0,expectedQuote:proposal.scenarios[0].expected}],missing:[]};
 const savedPlan={...proposal,contract};
 for(const inputsChanged of [false,true]){
  const edited=structuredClone(proposal);edited.scenarios[0].expected='按用户提供的说明核对结果';
  if(inputsChanged)edited.scenarios[0].setup='另一组输入';
  let saved,calls=0;
  await revisePreparedPlanContent({...args,body:{versionNumber:3,proposal:edited},repository:{getLatestSopProposal:async()=>({...current,proposal:savedPlan}),readCaseDiscussion:async()=>({turns:[]}),saveSopProposal:async(...args)=>{saved=args[3];}},complete:async request=>{
   if(++calls===1)return JSON.stringify({questions:[]});
   const context=JSON.parse(request.user);assert.equal(Boolean(context.currentPreparation),!inputsChanged);
   return JSON.stringify({applications:[],assumptions:['模型重写的假设'],expectations:[],missing:[]});
  }});
  assert.deepEqual(saved.contract.assumptions,inputsChanged?['模型重写的假设']:contract.assumptions);
  assert.equal(saved.contract.businessExpectations[0].expectedQuote,edited.scenarios[0].expected);
 }
});
