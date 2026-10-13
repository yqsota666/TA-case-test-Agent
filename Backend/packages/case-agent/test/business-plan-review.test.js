import test from 'node:test';
import assert from 'node:assert/strict';
import {definePlanContract} from '../src/plan-contract.js';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';
import {compareConfirmedExpectations} from '../src/case-result-graph.js';
import {workflowPosition} from '../src/durable-workflow.js';
const data={customers:[],accounts:[],funds:[],holdings:[],missing:[]};
const make=values=>({scenarios:values.map(expected=>({expected})),exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]}});
const derive=async plan=>(await definePlanContract(async input=>{assert.match(input.system,/不预设字段/);assert.match(input.system,/业务预期/);return JSON.stringify({assumptions:[],applications:[],expectations:[],missing:[]});},plan,[],data)).contract;
test('business comparisons accept different fields and counts without declaring a backend calculation or PASS',async()=>{
 for(const values of [['状态保持关闭','状态转为开放'],['输出为空'],Array.from({length:7},(_,i)=>`字段组合${i}对应独立结果`)]){
  const plan=make(values),contract=await derive(plan);
  assert.equal(validPlanContract(contract,plan),true);
  assert.deepEqual(contract.businessExpectations.map(e=>e.expectedQuote),values);
  assert.equal(compareConfirmedExpectations({plan:{...plan,contract},issues:[],pending:[],evidence:[]}).outcome,'REVIEW');
  const corrupted=structuredClone(contract);corrupted.businessExpectations[0].expectedQuote='未提出的结果';assert.equal(validPlanContract(corrupted,plan),false);
  const empty=structuredClone(contract);empty.businessExpectations=[];assert.equal(validPlanContract(empty,plan),false);
 }
});
test('a generic review cannot bypass required typed numeric TA expectations',async()=>{
 const plan=make(['确认金额100元']),contract=await derive(make(['业务金额规则按讨论执行']));
 contract.businessExpectations=[{scenarioIndex:0,expectedQuote:plan.scenarios[0].expected}];
 assert.equal(validPlanContract(contract,plan),false);
});
test('no-file drafts retain explicit confirmation and then skip phantom file-order steps',()=>{
 const facts={chatStatus:'ACTIVE',caseStatus:'SOP_LOCKED',plan:{status:'LOCKED',proposal:make(['业务预期'])},generated:true,draftConfirmed:true};
 assert.deepEqual(workflowPosition(facts),{stage:'EVALUATE_RESULT',waiting:['RESULT_EVALUATE']});
 assert.equal(workflowPosition({...facts,draftConfirmed:false}).stage,'CONFIRM_DRAFT');
 assert.equal(workflowPosition({...facts,plan:{status:'PENDING_CONFIRMATION'},dataConfirmed:true}).stage,'CONFIRM_EXPECTATIONS');
});
