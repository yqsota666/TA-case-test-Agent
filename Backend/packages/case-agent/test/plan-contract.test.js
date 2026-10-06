import test from 'node:test';
import assert from 'node:assert/strict';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';
import {definePlanContract} from '../src/plan-contract.js';
import {compareConfirmedExpectations,createCaseResultGraph} from '../src/case-result-graph.js';
import {planContract} from './plan-contract-fixture.js';
import {exchangePlan} from './exchange-plan-fixture.js';
const plan={scenarios:[{expected:'确认成功，CONFIRMED'}],exchangePlan};
const contract=planContract(plan);
test('strict Plan validates linked drafts, typed expectations and fixed application amounts before confirmation',async()=>{
 assert.equal(validPlanContract(contract,plan),true);
 for(const mutate of [c=>c.expectations[0].selector.accountIndex=9,c=>c.expectations[0].source='constructor',c=>c.expectations[0].selector.businessDate='20260230',c=>c.expectations[0].field='invented',c=>c.expectations=[],c=>c.applications[0].fields.TAAccountID='invented',c=>c.dataSpecification.accounts.push({customerIndex:9,branchCode:'306'})]){
  const c=structuredClone(contract);mutate(c);assert.equal(validPlanContract(c,plan),false);
 }
 const calls=[];
 const result=await definePlanContract(async input=>{calls.push(input);if(calls.length===1)return JSON.stringify(contract.dataSpecification);const {version,protocolVersion,dataSpecification,...derived}=contract;return JSON.stringify(derived);},plan);
 assert.deepEqual(result.contract,contract);assert.equal(calls.length,2);
 await assert.rejects(definePlanContract(async()=>'{invalid',plan),{code:'DATA_SPEC_INVALID'});
});
test('confirmed typed expectations match the exact account/round; ambiguity, missing and wrong outcomes never pass',async()=>{
 const snapshot={plan:{...plan,contract},preparedAccounts:[{transactionAccountId:'90000000000000001'}],evidence:[{id:'app:1',source:{kind:'APPLICATION_CONFIRMATION',channelId:'7',fileType:'03',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',status:'CONFIRMED'}}],pending:[],issues:[]};
 assert.equal(compareConfirmedExpectations(snapshot).outcome,'PASS');
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not reinterpret confirmed assertions');}});
 assert.equal((await graph.invoke({})).suggestion.outcome,'PASS');
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[]}).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[...snapshot.evidence,...snapshot.evidence]}).outcome,'REVIEW');
 const wrong=structuredClone(snapshot);wrong.evidence[0].values.status='FAILED';assert.equal(compareConfirmedExpectations(wrong).outcome,'FAIL');
 wrong.evidence[0].source.businessDate='20261007';assert.equal(compareConfirmedExpectations(wrong).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations({...snapshot,pending:['04未完成']}).outcome,'WAITING');
});

test('numeric expected values require an exact decimal literal in the quoted scenario, not inferred initial conditions',()=>{
 const quotedPlan={...plan,scenarios:[{expected:'确认成功，CONFIRMED；确认金额100.00元；最终总份额100份；无其他交易，不产生初始模拟持仓'}]};
 const c=planContract(quotedPlan),numeric={...c.expectations[0],expectedQuote:'确认金额100.00元',field:'confirmedAmount',expectedValue:'100'};
 c.expectations.push(numeric,{...numeric,source:'CURRENT_FORMAL_HOLDING',field:'totalVolume',expectedQuote:'最终总份额100份',selector:{...numeric.selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null}});assert.equal(validPlanContract(c,quotedPlan),true);
 numeric.expectedValue='100.00000001';assert.equal(validPlanContract(c,quotedPlan),false);
 numeric.expectedValue='100.00';numeric.expectedQuote='无其他交易，不产生初始模拟持仓';assert.equal(validPlanContract(c,quotedPlan),false);
 numeric.expectedValue='0';assert.equal(validPlanContract(c,quotedPlan),false);
 numeric.expectedValue='-100';numeric.expectedQuote='确认金额100.00元';assert.equal(validPlanContract(c,quotedPlan),false);
 const negativePlan={...quotedPlan,scenarios:[{expected:'确认金额-100.00元'}]};
 const n=planContract(negativePlan);n.expectations=[{...numeric,expectedQuote:'确认金额-100.00元',expectedValue:'-100.00000000'}];assert.equal(validPlanContract(n,negativePlan),true);
 n.expectations[0].expectedValue='100';assert.equal(validPlanContract(n,negativePlan),false);
 const precisePlan={...quotedPlan,scenarios:[{expected:'确认金额9007199254740993.01元'}]};
 const precise=planContract(precisePlan);precise.expectations=[{...numeric,expectedQuote:precisePlan.scenarios[0].expected,expectedValue:'9007199254740993.01'}];assert.equal(validPlanContract(precise,precisePlan),true);
 precise.expectations[0].expectedValue='9007199254740993.02';assert.equal(validPlanContract(precise,precisePlan),false);
});

test('model-invented available/frozen numeric checks fail contract generation and never pass a result graph',async()=>{
 const ungroundedPlan={...plan,scenarios:[{expected:'确认成功，CONFIRMED；无其他交易，不产生初始模拟持仓'}]};
 const ungrounded=planContract(ungroundedPlan);
 for(const [field,expectedValue] of [['availableVolume','100'],['frozenVolume','0']])ungrounded.expectations.push({
  ...ungrounded.expectations[0],expectedQuote:'无其他交易，不产生初始模拟持仓',source:'CURRENT_FORMAL_HOLDING',
  selector:{...ungrounded.expectations[0].selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null},field,expectedValue});
 assert.equal(validPlanContract(ungrounded,ungroundedPlan),false);
 let calls=0;await assert.rejects(definePlanContract(async()=>{if(++calls===1)return JSON.stringify(ungrounded.dataSpecification);const {version,protocolVersion,dataSpecification,...derived}=ungrounded;return JSON.stringify(derived);},ungroundedPlan),{code:'INVALID_PLAN_CONTRACT'});
 const snapshot={plan:{...ungroundedPlan,contract:ungrounded},pending:[],issues:[],evidence:[{id:'holding:1',source:{kind:'CURRENT_FORMAL_HOLDING',channelId:'7'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',availableVolume:'100.00',frozenVolume:'0.00'}}]};
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not reinterpret malformed confirmed contract');}});
 assert.equal((await graph.invoke({})).suggestion.outcome,'REVIEW');
});


test('numeric quote tokens reject exponent/thousands fragments and preserve Unicode negative signs',()=>{
 const make=(quote,value,field='confirmedAmount',source='APPLICATION_CONFIRMATION')=>{
  const p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
  c.expectations=[{...c.expectations[0],expectedQuote:quote,expectedValue:value,field,source}];
  if(source==='CURRENT_FORMAL_HOLDING')Object.assign(c.expectations[0].selector,{fundCode:'000001',shareClass:'0',fileType:null,businessDate:null});
  return validPlanContract(c,p);
 };
 for(const [quote,values] of [['确认金额1,000元',['1','0']],['确认金额1e3元',['1','3']],['确认金额USD100元',['100']],['确认金额100.000000001元',['100']]])for(const value of values)assert.equal(make(quote,value),false);
 assert.equal(make('确认金额−100.00元','100'),false);assert.equal(make('确认金额−100.00元','-100'),true);
 assert.equal(make('确认金额－100.00元','-100'),true);assert.equal(make('确认金额+100.00元','100'),true);
 assert.equal(make('确认金额100元,无需其他结果','100'),true);
 for(const field of ['confirmedAmount','confirmedVolume']){assert.equal(make(field+'100.00','100',field),true);assert.equal(make('明确结果100.00','100',field),false);assert.equal(make('未明确数字','100',field),false);}
 for(const field of ['totalVolume','availableVolume','frozenVolume']){assert.equal(make(field+'100.00','100',field,'CURRENT_FORMAL_HOLDING'),true);assert.equal(make('明确结果100.00','100',field,'CURRENT_FORMAL_HOLDING'),false);assert.equal(make('未明确数字','100',field,'CURRENT_FORMAL_HOLDING'),false);}
});
test('typed quantities bind each field in a shared Chinese quote and reject swapped or identifier values',()=>{
 const quote='场景1，基金代码000001：总份额100.00份、可用90.00份、冻结10.00份';
 const p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
 const fields=['totalVolume','availableVolume','frozenVolume'],values=['100','90','10'];
 const base=c.expectations[0];
 c.expectations=fields.map((field,i)=>({...base,field,source:'CURRENT_FORMAL_HOLDING',expectedQuote:quote,expectedValue:values[i],selector:{...base.selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null}}));
 assert.equal(validPlanContract(c,p),true);
 for(const value of ['1','000001','90']){const invalid=structuredClone(c);invalid.expectations[0].expectedValue=value;assert.equal(validPlanContract(invalid,p),false);}
 const swapped=structuredClone(c);swapped.expectations[1].expectedValue='10';swapped.expectations[2].expectedValue='90';assert.equal(validPlanContract(swapped,p),false);
});

test('typed nonnumeric tokens and field-local comparisons cannot invent PASS conditions',()=>{
 for(const [quote,field,value] of [['状态FAILED','status','CONFIRMED'],['状态NOT_CONFIRMED','status','CONFIRMED'],['TA账户TA0001','taAccountId','TA000']]){
  const p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
  Object.assign(c.expectations[0],{expectedQuote:quote,field,expectedValue:value});
  assert.equal(validPlanContract(c,p),false,quote);
 }
 const quote='总份额至少100份、可用90份',p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
 const base=c.expectations[0];
 c.expectations=[{...base,source:'CURRENT_FORMAL_HOLDING',field:'availableVolume',expectedValue:'90',expectedQuote:quote,operator:'gte',selector:{...base.selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null}}];
 assert.equal(validPlanContract(c,p),false);
 c.expectations[0].operator='eq';c.expectations.push({...c.expectations[0],field:'totalVolume',expectedValue:'100',operator:'gte'});assert.equal(validPlanContract(c,p),true);
});

test('typed contracts cannot omit explicit numeric fields and silently PASS changed balances',async()=>{
 const quote='总份额100份、可用90份、冻结10份',p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
 const base=c.expectations[0];
 c.expectations=[{...base,source:'CURRENT_FORMAL_HOLDING',field:'totalVolume',expectedValue:'100',expectedQuote:quote,selector:{...base.selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null}}];
 assert.equal(validPlanContract(c,p),false);
 const snapshot={plan:{...p,contract:c},preparedAccounts:[],pending:[],issues:[],evidence:[{id:'holding:1',source:{kind:'CURRENT_FORMAL_HOLDING',channelId:'7'},values:{transactionAccountId:'90000000000000001',fundCode:'000001',shareClass:'0',totalVolume:'100',availableVolume:'80',frozenVolume:'20'}}]};
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not reinterpret a confirmed incomplete contract');}});
 assert.equal((await graph.invoke({})).suggestion.outcome,'REVIEW');
 c.missing=['可用和冻结尚未绑定明确核验条件'];assert.equal(validPlanContract(c,p),true);
 assert.equal(compareConfirmedExpectations(snapshot).outcome,'REVIEW');
 c.missing=[];c.expectations.push({...c.expectations[0],field:'availableVolume',expectedValue:'90'},{...c.expectations[0],field:'frozenVolume',expectedValue:'10'});
 assert.equal(validPlanContract(c,p),true);assert.equal(compareConfirmedExpectations(snapshot).outcome,'FAIL');
});

test('typed nonnumeric literals cannot borrow another field or negate the quoted result',()=>{
 for(const [quote,field,value] of [['基金代码000001','taAccountId','000001'],['状态不是CONFIRMED','status','CONFIRMED'],['状态不为CONFIRMED','status','CONFIRMED'],['status not CONFIRMED','status','CONFIRMED']]){
  const p={...plan,scenarios:[{expected:quote}]},c=planContract(p);
  Object.assign(c.expectations[0],{expectedQuote:quote,field,expectedValue:value});
  assert.equal(validPlanContract(c,p),false,quote);
 }
});

test('typed quote extraction cannot remove recognized negative scenario context',()=>{
 for(const [expected,quote,field,value] of [['不要确认金额100','确认金额100','confirmedAmount','100'],['不期望状态CONFIRMED','状态CONFIRMED','status','CONFIRMED']]){
  const p={...plan,scenarios:[{expected}]},c=planContract(p);Object.assign(c.expectations[0],{expectedQuote:quote,field,expectedValue:value});
  assert.equal(validPlanContract(c,p),false);
 }
});

test('typed status questions and alternatives remain invalid even in historical contracts',()=>{
 for(const expected of ['开户状态为CONFIRMED吗？','开户状态为CONFIRMED或FAILED']){
  const p={...plan,scenarios:[{expected}]},c=planContract(p);
  assert.equal(validPlanContract(c,p),false,expected);
 }
});


test('independent 05 preparation prompt keeps existing formal identity and final balances out of initial drafts',async()=>{
 const p={objective:'独立05核对',preconditions:['沿用已有正式交易账号97252314162040660','客户、账户、持仓草稿为空'],scenarios:[{expected:'最终总份额100.00、可用90.00、冻结10.00'}],exchangePlan:{status:'READY',openQuestions:[],steps:[{stepId:'receive05',roundId:'holding',direction:'RECEIVE',fileType:'05',required:true,businessTime:{kind:'DATE',value:'20261011'},dependsOn:[]}]}};
 const data={customers:[],accounts:[],funds:[{fundCode:'000007',fundName:'合成基金',shareClass:'0',nav:'1.00000000'}],holdings:[],missing:[]};
 const requests=[];
 const result=await definePlanContract(async request=>{
  requests.push(request);
  if(requests.length===1)return JSON.stringify(data);
  return JSON.stringify({assumptions:['正式数据以显式同步05为准'],applications:[],missing:[],expectations:[['totalVolume','100.00'],['availableVolume','90.00'],['frozenVolume','10.00']].map(([field,expectedValue])=>({scenarioIndex:0,expectedQuote:p.scenarios[0].expected,source:'CURRENT_FORMAL_HOLDING',selector:{accountIndex:null,transactionAccountId:'97252314162040660',channelId:'2',fundCode:'000007',shareClass:'0',fileType:null,businessDate:null},field,operator:'eq',expectedValue}))});
 },p);
 assert.equal(requests.length,2);
 assert.match(requests[0].system,/三个数组必须保持为空/);assert.match(requests[0].system,/不得倒填为初始模拟/);assert.match(requests[0].system,/不因为草稿schema没有availableVolume\/frozenVolume而列missing/);
 assert.deepEqual(result.contract.dataSpecification,data);assert.equal(result.contract.applications.length,0);assert.equal(result.contract.expectations.length,3);assert.deepEqual(result.contract.missing,[]);
});
