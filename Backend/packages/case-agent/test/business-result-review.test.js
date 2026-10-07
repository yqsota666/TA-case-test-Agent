import test from 'node:test';
import assert from 'node:assert/strict';
import {compareConfirmedExpectations,canConfirmCaseResult,createCaseResultGraph} from '../src/case-result-graph.js';
const snapshot=(values=['字段改变后输出关闭'])=>{
 const scenarios=values.map(expected=>({title:'核对',setup:'按需求',action:'执行',expected,evidence:'业务输出'}));
 return {plan:{scenarios,exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]},contract:{version:2,protocolVersion:'22',dataSpecification:{customers:[],accounts:[],funds:[],holdings:[],missing:[]},assumptions:[],expectations:[],applications:[],missing:[],businessExpectations:values.map((expectedQuote,scenarioIndex)=>({scenarioIndex,expectedQuote}))}},evidence:[],pending:[],issues:[],businessOutput:{id:'7',sourceKind:'SYNTHETIC_TEST',content:values.map((v,i)=>`情况${i}实际：${v}`).join('\n')}};
};
const proposal=s=>({checks:s.plan.contract.businessExpectations.map(e=>({...e,evidenceId:'business-output:7',resultQuote:`情况${e.scenarioIndex}实际：${e.expectedQuote}`,verdict:'MATCH',explanation:'已提供的实际输出与条件对应'})),uncertainties:[]});
test('business results cover variable field names, comparison counts and non-comparison content',()=>{
 for(const values of [['输出关闭'],['渠道改变时保留原值','空字段被拒绝'],Array.from({length:7},(_,i)=>`第${i}个变化对应特定输出`)]){
  const s=snapshot(values),p=proposal(s),result=compareConfirmedExpectations(s,p);
  assert.equal(result.outcome,'PASS');assert.equal(result.businessChecks.length,values.length);assert.equal(canConfirmCaseResult(s,result),true);
  assert.equal(compareConfirmedExpectations({...s,businessOutput:null},p).outcome,'REVIEW');
 }
});
test('missing, duplicate, unsupported or fabricated business evidence cannot finalize',()=>{
 const s=snapshot(['启用后输出开放','停用后输出关闭']),p=proposal(s);
 const bad=[{...p,checks:p.checks.slice(0,1)},{...p,checks:[p.checks[0],p.checks[0]]},{...p,checks:p.checks.map(c=>({...c,resultQuote:'虚构结果'}))},{...p,checks:p.checks.map(c=>({...c,evidenceId:'foreign'}))},{...p,checks:p.checks.map(c=>({...c,expectedQuote:'不同预期'}))},{...p,checks:p.checks.map(c=>({...c,verdict:'UNCLEAR'}))},{...p,uncertainties:['字段缺失']}];
 for(const value of bad){const result=compareConfirmedExpectations(s,value);assert.equal(result.outcome,'REVIEW');assert.equal(canConfirmCaseResult(s,result),false);}
 assert.equal(compareConfirmedExpectations({...s,pending:['等待回传']},p).outcome,'WAITING');
 assert.equal(compareConfirmedExpectations({...s,issues:['原件摘要不一致']},p).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations(s,{...p,checks:p.checks.map(c=>({...c,verdict:'DIFFERENT'}))}).outcome,'FAIL');
});
test('strict result graph invokes business model only with complete protocol evidence and supplied output',async()=>{
 let calls=0;const s=snapshot();
 const run=state=>createCaseResultGraph({collect:async()=>state,complete:async request=>{calls++;assert.match(request.system,/不执/);return JSON.stringify(proposal(state));}}).invoke({});
 assert.equal((await run(s)).suggestion.outcome,'PASS');assert.equal(calls,1);
 assert.equal((await run({...s,businessOutput:null})).suggestion.outcome,'REVIEW');assert.equal(calls,1);
 assert.equal((await run({...s,pending:['等待回传']})).suggestion.outcome,'WAITING');assert.equal(calls,1);
 assert.equal((await run({...s,issues:['原件不完整']})).suggestion.outcome,'REVIEW');assert.equal(calls,1);
});
test('a matching business suggestion cannot hide missing or failed protocol assertions',async()=>{
 const {planContract}=await import('./plan-contract-fixture.js');const {exchangePlan}=await import('./exchange-plan-fixture.js');
 const s=snapshot(['状态CONFIRMED；字段变化后输出关闭']);s.plan.exchangePlan=exchangePlan;
 s.plan.contract={...planContract(s.plan),version:2,businessExpectations:s.plan.contract.businessExpectations};
 const p=proposal(s);
 const evidence={id:'application:1',source:{kind:'APPLICATION_CONFIRMATION',channelId:'1',fileType:'03',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',status:'FAILED'}};
 const failed=compareConfirmedExpectations({...s,evidence:[evidence]},p);
 assert.equal(failed.outcome,'FAIL');assert.equal(failed.checks[0].matched,false);
 assert.equal(compareConfirmedExpectations(s,p).outcome,'REVIEW');
 assert.equal(canConfirmCaseResult(s,failed),false);
});
