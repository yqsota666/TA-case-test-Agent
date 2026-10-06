import test from 'node:test';import assert from 'node:assert/strict';
import {compareCaseResults,createCaseResultGraph} from '../src/case-result-graph.js';
const snapshot={plan:{scenarios:[{expected:'总份额150份'}]},evidence:[{id:'h',source:{kind:'HOLDING'},values:{totalVolume:'150.00'}}],issues:[],pending:[]};
const proposal={assertions:[{scenarioIndex:0,expectedQuote:'总份额150份',evidenceId:'h',field:'totalVolume',operator:'eq',expectedValue:'150'}],uncertainties:[]};
test('result compares actual evidence precisely; ungrounded/missing/ambiguous assertions never pass',()=>{
 assert.equal(compareCaseResults(snapshot,proposal).outcome,'PASS');
 assert.equal(compareCaseResults({...snapshot,evidence:[{...snapshot.evidence[0],values:{totalVolume:'140.00'}}]},proposal).outcome,'FAIL');
 assert.equal(compareCaseResults({...snapshot,pending:['等待05同步']},proposal).outcome,'WAITING');
 for(const patch of [{expectedValue:'140'},{evidenceId:'foreign'},{expectedQuote:'返回正确'},{field:'missing'}])assert.equal(compareCaseResults(snapshot,{...proposal,assertions:[{...proposal.assertions[0],...patch}]}).outcome,'REVIEW');
 assert.equal(compareCaseResults(snapshot,{assertions:[],uncertainties:[]}).outcome,'REVIEW');
});
test('graph collects -> interprets -> explains -> waits for human; pending skips model and malformed model requires review',async()=>{
 let calls=0;const run=(value,response)=>createCaseResultGraph({collect:async()=>value,complete:async()=>{calls++;return response;}}).invoke({});
 let state=await run(snapshot,JSON.stringify(proposal));assert.equal(state.phase,'AWAITING_CONFIRMATION');assert.equal(state.suggestion.outcome,'PASS');
 state=await run({...snapshot,pending:['未同步']},'bad');assert.equal(state.suggestion.outcome,'WAITING');assert.equal(calls,1);
 assert.equal((await run(snapshot,'not json')).suggestion.outcome,'REVIEW');
});
test('partial numeric coverage and invented comparison directions require clarification',()=>{
 const two={...snapshot,plan:{scenarios:[{expected:'总份额150份，可用120份'}]}};
 assert.equal(compareCaseResults(two,proposal).outcome,'REVIEW');
 assert.equal(compareCaseResults(snapshot,{...proposal,assertions:[{...proposal.assertions[0],operator:'gte'}]}).outcome,'REVIEW');
});
test('numeric expectations bind to their own fields, not identifiers or other balances',()=>{
 const quote='场景1，基金代码000001：总份额100.00份、可用90.00份、冻结10.00份';
 const fields=['totalVolume','availableVolume','frozenVolume'],values=['100','90','10'];
 const source={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:Object.fromEntries(fields.map((f,i)=>[f,values[i]]))}]};
 const valid={assertions:fields.map((field,i)=>({...proposal.assertions[0],field,expectedQuote:quote,expectedValue:values[i]})),uncertainties:[]};
 assert.equal(compareCaseResults(source,valid).outcome,'PASS');
 for(const value of ['1','000001','90'])assert.equal(compareCaseResults(source,{...valid,assertions:[{...valid.assertions[0],expectedValue:value},...valid.assertions.slice(1)]}).outcome,'REVIEW');
 const swapped={...valid,assertions:valid.assertions.map((a,i)=>({...a,expectedValue:values[(i+1)%3]}))};
 assert.equal(compareCaseResults(source,swapped).outcome,'REVIEW');
 const equal={...source,plan:{scenarios:[{expected:'总份额100份、可用100份、冻结0份'}]},evidence:[{...source.evidence[0],values:{totalVolume:'100',availableVolume:'100',frozenVolume:'0'}}]};
 assert.equal(compareCaseResults(equal,{assertions:[{...valid.assertions[0],expectedQuote:equal.plan.scenarios[0].expected},{...valid.assertions[2],expectedQuote:equal.plan.scenarios[0].expected,expectedValue:'0'}],uncertainties:[]}).outcome,'REVIEW');
});

test('legacy model assertions cannot turn malformed numbers or negated expectations into PASS',()=>{
 for(const [quote,value] of [['总份额10e2','1'],['总份额100,000','10'],['总份额1e+2','1'],['总份额1e-2','1'],['总份额100.1.2','10'],['总份额不等于10','10']]){
  const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:{totalVolume:value}}]};
  const assertion={...proposal.assertions[0],expectedQuote:quote,expectedValue:value};
  assert.equal(compareCaseResults(state,{assertions:[assertion],uncertainties:[]}).outcome,'REVIEW',quote);
 }
});

test('another field range cannot authorize an invented operator on this field',()=>{
 const quote='总份额至少100份，可用90份';
 const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:{totalVolume:'100',availableVolume:'95'}}]};
 const a={...proposal.assertions[0],expectedQuote:quote,expectedValue:'100',operator:'gte'};
 const b={...a,field:'availableVolume',expectedValue:'90'};
 assert.equal(compareCaseResults(state,{assertions:[a,b],uncertainties:[]}).outcome,'REVIEW');
 assert.equal(compareCaseResults(state,{assertions:[a,{...b,operator:'eq'}],uncertainties:[]}).outcome,'FAIL');
});

test('non-numeric expected values need complete literal tokens from the quoted plan',()=>{
 for(const [quote,field,value] of [['状态FAILED','status','CONFIRMED'],['状态NOT_CONFIRMED','status','CONFIRMED'],['TA账户TA0001','taAccountId','TA000'],['日期20261006','snapshotDate','2026100']]){
  const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:{[field]:value}}]};
  const assertion={...proposal.assertions[0],expectedQuote:quote,field,expectedValue:value};
  assert.equal(compareCaseResults(state,{assertions:[assertion],uncertainties:[]}).outcome,'REVIEW',quote);
 }
 const quote='申请最终状态均为CONFIRMED';
 const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:{status:'CONFIRMED'}}]};
 assert.equal(compareCaseResults(state,{assertions:[{...proposal.assertions[0],expectedQuote:quote,field:'status',expectedValue:'CONFIRMED'}],uncertainties:[]}).outcome,'PASS');
});

test('invalid numeric formats, borrowed field literals and negation cannot recommend PASS',()=>{
 for(const [quote,field,value] of [['总份额1e2','totalVolume','1e2'],['总份额100.000000001','totalVolume','100.000000001'],['基金代码000001','taAccountId','000001'],['状态不是CONFIRMED','status','CONFIRMED'],['不是状态CONFIRMED','status','CONFIRMED']]){
  const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[{...snapshot.evidence[0],values:{[field]:value}}]};
  assert.equal(compareCaseResults(state,{assertions:[{...proposal.assertions[0],expectedQuote:quote,field,expectedValue:value}],uncertainties:[]}).outcome,'REVIEW',quote);
 }
});

test('the full scenario preserves negation even when a model shortens its quote',()=>{
 for(const [expected,quote,field,value] of [['不要总份额100','总份额100','totalVolume','100'],['不期望状态CONFIRMED','状态CONFIRMED','status','CONFIRMED']]){
  const state={...snapshot,plan:{scenarios:[{expected}]},evidence:[{...snapshot.evidence[0],values:{[field]:value}}]};
  assert.equal(compareCaseResults(state,{assertions:[{...proposal.assertions[0],expectedQuote:quote,field,expectedValue:value}],uncertainties:[]}).outcome,'REVIEW');
 }
});
