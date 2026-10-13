import test from 'node:test';
import assert from 'node:assert/strict';
import {operationPlan} from './operation-chain-fixture.js';
import {validPlanContract} from '../../platform-protocol/src/plan-contract.js';
import {operationSerial,reconcileOperations,createOperationChainGraph} from '../src/operation-chain-graph.js';
import {compareConfirmedExpectations} from '../src/case-result-graph.js';
import {operationFailureBlockers} from '../../platform-store/src/operation-failure.js';
import {definePlanContract} from '../src/plan-contract.js';

const scope={casePublicId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',channelId:'7'};
const actual=(key,status)=>({channelId:'7',applicationNumber:operationSerial({...scope,key}),status});
const parsed=id=>({stepId:id,condition:'PARSED'});
test('variable operation chains validate and only opening tasks are initially ready',async()=>{
  for(const accounts of [1,2,4])for(const rounds of [1,2,4]){
    const plan=operationPlan({accounts,rounds});assert.equal(validPlanContract(plan.contract,plan),true);
    const {schedule}=await createOperationChainGraph().invoke({input:{plan,...scope}});
    assert.deepEqual(schedule.readyKeys,Array.from({length:accounts},(_,i)=>`open_${i}`));
    assert.equal(schedule.tasks.length,accounts*(rounds+1));
  }
});
test('partial real confirmations release only the matching account; parsed and delivered do not mean success',()=>{
  const plan=operationPlan();
  const input={plan,...scope,events:[parsed('opened')],applications:[actual('open_0','CONFIRMED'),actual('open_1','WAITING_RETURN')]};
  assert.deepEqual(reconcileOperations(input).readyKeys,['trade_0_0']);
  input.applications[1]=actual('open_1','FAILED');
  const schedule=reconcileOperations(input);
  assert.deepEqual(schedule.readyKeys,['trade_0_0']);assert.equal(schedule.tasks.find(t=>t.key==='trade_1_1').state,'BLOCKED');
  input.applications=[actual('open_0','WAITING_RETURN'),actual('open_1','WAITING_RETURN')];
  assert.deepEqual(reconcileOperations(input).readyKeys,[]);
});
test('same-day later trades wait for their exact prior application and file parsing, including after restart',()=>{
  const plan=operationPlan({accounts:1});
  const input={plan,...scope,applications:[actual('open_0','CONFIRMED'),actual('trade_0_0','GENERATED')],events:[parsed('opened')]};
  assert.deepEqual(reconcileOperations(input).readyKeys,['trade_0_0']);
  input.applications[1].status='CONFIRMED';
  assert.deepEqual(reconcileOperations(input).readyKeys,[]);
  input.events.push(parsed('returned_0'));
  const restored=JSON.parse(JSON.stringify(input));
  assert.deepEqual(reconcileOperations(restored).readyKeys,['trade_1_0']);
});
test('invalid references, cycles, same-file dependencies and another account opening are rejected',()=>{
  for(const change of [
    p=>p.contract.applications[2].dependsOn=[{applicationKey:'missing',condition:'CONFIRMED'}],
    p=>p.contract.applications[0].dependsOn=[{applicationKey:'trade_0_0',condition:'CONFIRMED'}],
    p=>p.contract.applications[2].dependsOn=[{applicationKey:'open_1',condition:'CONFIRMED'}],
    p=>p.contract.applications[3].dependsOn.push({applicationKey:'trade_0_0',condition:'CONFIRMED'}),
    p=>p.contract.applications[2].dependsOn=[null],
  ]){const plan=operationPlan();change(plan);assert.equal(validPlanContract(plan.contract,plan),false);}
});
test('application keys disambiguate the same account, fund and day without selecting another trade result',()=>{
  const plan=operationPlan({accounts:1}),applications=plan.contract.applications;
  const snapshot={...scope,plan,issues:[],pending:[],preparedAccounts:[{transactionAccountId:'90000000000000001'}],evidence:applications.map(a=>({id:a.key,source:{kind:'APPLICATION_CONFIRMATION',channelId:'7',applicationNumber:operationSerial({...scope,key:a.key}),fileType:a.businessCode==='001'?'01':'03',businessDate:'20261008'},values:{transactionAccountId:'90000000000000001',fundCode:a.fundIndex===null?null:'000001',shareClass:a.fundIndex===null?null:'0',status:a.businessCode==='024'?'FAILED':'CONFIRMED'}}))};
  const result=compareConfirmedExpectations(snapshot);
  assert.equal(result.outcome,'FAIL');assert.equal(result.checks.length,3);assert.equal(result.checks[2].evidenceId,'trade_1_0');
});
test('a failed account does not block shared file steps needed by another account',()=>{
  const plan=operationPlan(),failure={...scope,stepId:'opened',applicationId:'1',record:{AppSheetSerialNo:operationSerial({...scope,key:'open_1'}),TransactionAccountID:'90000000000000002'},returnCode:'1001'};
  const blockers=operationFailureBlockers({plan,order:{plan:plan.exchangePlan},applications:[],failures:[failure]});
  assert.deepEqual(blockers[0].blockedStepIds,[]);
  assert.deepEqual(blockers[0].blockedApplicationKeys,['trade_0_1','trade_1_1']);
});
test('optional or already delivered branches are not sealed as required unexecuted failures',()=>{
  const plan=operationPlan({accounts:1}),failure={...scope,stepId:'opened',record:{AppSheetSerialNo:operationSerial({...scope,key:'open_0'})}};
  for(const s of plan.exchangePlan.steps.filter(s=>s.fileType==='03'||s.fileType==='04'))s.required=false;
  assert.deepEqual(operationFailureBlockers({plan,order:{plan:plan.exchangePlan},applications:[],failures:[failure]}),[]);
  for(const s of plan.exchangePlan.steps)s.required=true;
  assert.deepEqual(operationFailureBlockers({plan,order:{plan:plan.exchangePlan,events:[{stepId:'trade_0',condition:'SENT'},{stepId:'trade_1',condition:'SENT'}]},applications:[],failures:[failure]}),[]);
});
test('later waves may inherit opening receipt gates through earlier file dependencies',()=>{
  const plan=operationPlan();plan.exchangePlan.steps.find(s=>s.stepId==='trade_1').dependsOn=[{stepId:'returned_0',condition:'PARSED'}];
  assert.equal(validPlanContract(plan.contract,plan),true);
});
test('model construction retries omitted required protocol inputs before asking for business information',async()=>{
  const plan=operationPlan();const {version,protocolVersion,dataSpecification,businessExpectations,...valid}=plan.contract;
  for(const value of [undefined,'SYN'+'0'.repeat(40)]){
    const incomplete=structuredClone(valid);if(value===undefined)delete incomplete.applications[0].fields.CertificateNo;else incomplete.applications[0].fields.CertificateNo=value;
    let calls=0;
    const result=await definePlanContract(async request=>{calls++;if(calls===2)assert.ok(JSON.parse(request.user).validationIssues.some(q=>q.includes('模拟证件号')&&(value===undefined||q.includes('最多40字节'))));return JSON.stringify(calls===1?incomplete:valid);},plan,[],dataSpecification);
    assert.equal(calls,2);assert.deepEqual(result.contract.missing,[]);
  }
});
