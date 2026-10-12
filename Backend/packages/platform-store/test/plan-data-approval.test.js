import test from 'node:test';
import assert from 'node:assert/strict';
import {samePlanPreparation,preparedDataMatches} from '../src/plan-data-approval.js';

const specification={customers:[{name:'陈思远',investorType:'1',simulatedBalance:'1000.00'}],accounts:[{customerIndex:0,branchCode:'306'}],funds:[{fundCode:'000001',fundName:'合成基金',shareClass:'0',nav:'1.00000000'}],holdings:[{accountIndex:0,fundIndex:0,totalVolume:'100.00000000'}],missing:[]};
const plan={objective:'字段核对',preconditions:['相同条件'],scenarios:[{setup:'已有数据',action:'执行操作',expected:'原预期',evidence:'原证据'}],exchangePlan:{steps:[]},contract:{version:4,dataSpecification:specification,applications:[],assumptions:[],expectations:[],businessExpectations:[],missing:[]}};
const data={customers:[{id:'1',name:'陈思远',investor_type:'1',simulated_balance:'1000.00'}],accounts:[{id:'2',customer_id:'1',account_no:'90000000000000001',branch_code:'306'}],funds:[{id:'3',fund_code:'000001',fund_name:'合成基金',share_class:'0',nav:'1.00000000'}],holdings:[{account_id:'2',fund_code:'000001',share_class:'0',total_volume:'100.00'}]};
test('expectation-only edits preserve data approval; preparation and relationships never do',()=>{
  const changed=structuredClone(plan);changed.scenarios[0].expected='新预期';changed.scenarios[0].evidence='新证据';changed.contract.businessExpectations=[{expectedQuote:'新预期'}];
  assert.equal(samePlanPreparation(plan,changed),true);
  for(const mutate of [p=>p.preconditions.push('不同条件'),p=>p.scenarios[0].action='另一个操作',p=>p.contract.dataSpecification.customers[0].simulatedBalance='2000.00',p=>p.contract.applications.push({fields:{ApplicationAmount:'2000.00'}}),p=>p.exchangePlan.steps.push({businessTime:'另一天'})]){
    const next=structuredClone(changed);mutate(next);assert.equal(samePlanPreparation(plan,next),false);
  }
  assert.equal(samePlanPreparation({},plan),false);
});
test('generated records match approved values and exact references with decimal scale equivalence',()=>{
  assert.equal(preparedDataMatches(data,specification),true);
  for(const mutate of [d=>d.customers[0].simulated_balance='1000.01',d=>d.accounts[0].customer_id='9',d=>d.accounts[0].branch_code='999',d=>d.holdings[0].account_id='9',d=>d.holdings[0].share_class='1',d=>d.holdings[0].total_volume='101.00',d=>d.funds[0].nav='1.00000001',d=>d.customers.push({...d.customers[0]}),d=>d.accounts[0].account_no='unknown']){
    const next=structuredClone(data);mutate(next);assert.equal(preparedDataMatches(next,specification),false);
  }
  assert.equal(preparedDataMatches(data,{...specification,missing:['条件未定']}),false);
});
