import test from 'node:test';import assert from 'node:assert/strict';
import {compareCaseResults,canConfirmCaseResult} from '../src/case-result-graph.js';
const expected='账号90000000000000001申购成功，基金代码000001，日期20261006，通道7，确认份额100份';
const snapshot={plan:{scenarios:[{expected}]},pending:[],issues:[],evidence:[{id:'app',source:{kind:'APPLICATION_CONFIRMATION',fileType:'03',channelId:'7',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',status:'CONFIRMED',confirmedVolume:'100'}}]};
const check=field=>({scenarioIndex:0,expectedQuote:expected,evidenceId:'app',field,operator:'eq',expectedValue:field==='status'?'CONFIRMED':'100'});
const complete={assertions:[check('status'),check('confirmedVolume')],uncertainties:[]};
test('legacy numeric-only saved assertion cannot omit explicit successful status or identity scope',()=>{
 const result=compareCaseResults(snapshot,{assertions:[check('confirmedVolume')],uncertainties:[]});assert.equal(result.outcome,'REVIEW');assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS',checks:result.checks}),false);
 for(const field of ['transactionAccountId','fundCode']){const s=structuredClone(snapshot);s.evidence[0].values[field]='999';assert.equal(compareCaseResults(s,complete).outcome,'REVIEW');}
 for(const field of ['businessDate','channelId']){const s=structuredClone(snapshot);s.evidence[0].source[field]='999';assert.equal(compareCaseResults(s,complete).outcome,'REVIEW');}
});
test('fully bound explicit legacy PASS and genuine FAIL remain eligible; unknown/ambiguous language is REVIEW',()=>{
 const ambiguous=structuredClone(snapshot);ambiguous.evidence.push({...structuredClone(ambiguous.evidence[0]),id:'second'});assert.equal(compareCaseResults(ambiguous,complete).outcome,'REVIEW');
 const pass=compareCaseResults(snapshot,complete);assert.equal(pass.outcome,'PASS');assert.equal(canConfirmCaseResult(snapshot,pass),true);
 const failed=structuredClone(snapshot);failed.evidence[0].values.status='FAILED';const fail=compareCaseResults(failed,complete);assert.equal(fail.outcome,'FAIL');assert.equal(canConfirmCaseResult(failed,fail),true);
 for(const text of ['申购成功还是失败，确认份额100份','状态CONFIRMED，FAILED','结果符合某行业规则，确认份额100份','TA返回码0000，确认份额100份','TA账号TA000001，确认份额100份','份额类别1，确认份额100份']){
  const s=structuredClone(snapshot);s.plan.scenarios[0].expected=text;assert.equal(compareCaseResults(s,{assertions:[{...check('confirmedVolume'),expectedQuote:text}],uncertainties:[]}).outcome,'REVIEW',text);
 }
});

test('explicit TA/account/branch/status literals are all required, while simplified Chinese status maps to the same enum',()=>{
 const text='状态成功，TA账号TA000001，网点306，返回码0000';
 const state={...snapshot,plan:{scenarios:[{expected:text}]},evidence:[{...snapshot.evidence[0],values:{status:'CONFIRMED',taAccountId:'TA000001',branchCode:'306',returnCode:'0000'}}]};
 const assertions=[['status','CONFIRMED'],['taAccountId','TA000001'],['branchCode','306'],['returnCode','0000']].map(([field,expectedValue])=>({...check(field),expectedQuote:text,expectedValue}));
 assert.equal(compareCaseResults(state,{assertions,uncertainties:[]}).outcome,'PASS');
 for(let i=0;i<assertions.length;i++)assert.equal(compareCaseResults(state,{assertions:assertions.filter((_,j)=>j!==i),uncertainties:[]}).outcome,'REVIEW');
});

test('business status type binds application evidence while separately bound formal holdings remain comparable',()=>{
 const quote='账号90000000000000001申购成功，基金代码000001，总份额100份';
 const state={...snapshot,plan:{scenarios:[{expected:quote}]},evidence:[snapshot.evidence[0],{id:'holding',source:{kind:'CURRENT_FORMAL_HOLDING',channelId:'7'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',totalVolume:'100'}}]};
 const assertions=[{...check('status'),expectedQuote:quote},{...check('totalVolume'),expectedQuote:quote,evidenceId:'holding'}];
 assert.equal(compareCaseResults(state,{assertions,uncertainties:[]}).outcome,'PASS');
});

test('one legacy scenario cannot splice unique application and holding evidence across identities or missing scope',()=>{
 const quote='申购成功，总份额100份';
 const make=()=>({plan:{scenarios:[{expected:quote}]},pending:[],issues:[],evidence:[{id:'app',source:{kind:'APPLICATION_CONFIRMATION',fileType:'03',channelId:'7',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',status:'CONFIRMED'}},{id:'holding',source:{kind:'CURRENT_FORMAL_HOLDING',channelId:'7'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',totalVolume:'100',snapshotDate:'20261007'}}]});
 const assertions=[{...check('status'),expectedQuote:quote},{...check('totalVolume'),expectedQuote:quote,evidenceId:'holding'}];
 const compare=s=>compareCaseResults(s,{assertions,uncertainties:[]});
 assert.equal(compare(make()).outcome,'PASS');
 for(const field of ['transactionAccountId','fundCode','shareClass','channelId'])for(const value of ['different',undefined]){
  const state=make();if(field==='channelId')state.evidence[1].source[field]=value;else state.evidence[1].values[field]=value;
  const result=compare(state);assert.equal(result.outcome,'REVIEW',field);assert.equal(canConfirmCaseResult(state,{...result,outcome:'PASS'}),false);
 }
 const opening=make();opening.plan.scenarios[0].expected='开户成功，总份额100份';opening.evidence[0].source.fileType='01';opening.evidence[0].values.fundCode=null;opening.evidence[0].values.shareClass=null;
 assert.equal(compareCaseResults(opening,{assertions:assertions.map(a=>({...a,expectedQuote:opening.plan.scenarios[0].expected})),uncertainties:[]}).outcome,'PASS');
});
