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
