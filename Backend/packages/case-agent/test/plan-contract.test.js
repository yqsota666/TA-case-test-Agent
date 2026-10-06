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
 c.expectations.push(numeric);assert.equal(validPlanContract(c,quotedPlan),true);
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
 for(const field of ['confirmedAmount','confirmedVolume']){assert.equal(make('明确结果100.00','100',field),true);assert.equal(make('未明确数字','100',field),false);}
 for(const field of ['totalVolume','availableVolume','frozenVolume']){assert.equal(make('明确结果100.00','100',field,'CURRENT_FORMAL_HOLDING'),true);assert.equal(make('未明确数字','100',field,'CURRENT_FORMAL_HOLDING'),false);}
});
