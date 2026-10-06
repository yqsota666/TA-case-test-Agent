import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaseResultGraph,terminalFailureSuggestion} from '../src/case-result-graph.js';
test('blocked legacy Case diagnoses FAIL without asking the model to invent future returns',async()=>{
 const snapshot={plan:{scenarios:[{expected:'状态CONFIRMED'}]},evidence:[],pending:[],issues:[],blockers:[{failedStepId:'r02',blockedStepIds:['s03','r04']}]};
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not call model for dependency failure');}});
 const result=await graph.invoke({});assert.equal(result.suggestion.outcome,'FAIL');assert.deepEqual(result.suggestion.blockers,snapshot.blockers);assert.deepEqual(result.suggestion.checks,[]);
});
test('unaffected pending operations and corrupt evidence prevent diagnostic FAIL from becoming confirmable',()=>{
 const snapshot={pending:[],issues:[],blockers:[{blockedStepIds:['s03','r04']}]};
 assert.equal(terminalFailureSuggestion({...snapshot,pending:['另一必需分支未收04']}),null);
 assert.equal(terminalFailureSuggestion({...snapshot,issues:['原件摘要不一致']}),null);
 assert.equal(terminalFailureSuggestion({...snapshot,blockers:[]}),null);
});

test('truncated dependency candidates require REVIEW even with pending files, and never call the model',async()=>{
 const snapshot={plan:{scenarios:[{expected:'状态CONFIRMED'}]},evidence:[],pending:['必需03/04尚未完成'],issues:['TA失败或关联申请超过500项'],terminalFailuresTruncated:true};
 const result=await createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('partial mapping must not be interpreted by a model');}}).invoke({});assert.equal(result.suggestion.outcome,'REVIEW');assert.deepEqual(result.suggestion.issues,snapshot.issues);assert.equal(result.suggestion.blockers,undefined);
});

test('only missing expectations precisely caused by a blocker allow diagnostic FAIL; independent missing/ambiguous values require REVIEW',async()=>{
 const {planContract}=await import('./plan-contract-fixture.js'),{exchangePlan}=await import('./exchange-plan-fixture.js');
 const plan={exchangePlan,scenarios:[{expected:'状态CONFIRMED；总份额100份'}]},contract=planContract(plan);plan.contract=contract;
 const holding={...contract.expectations[0],expectedQuote:'总份额100份',source:'CURRENT_FORMAL_HOLDING',selector:{...contract.expectations[0].selector,fundCode:'000001',shareClass:'0',fileType:null,businessDate:null},field:'totalVolume',expectedValue:'100'};contract.expectations.push(holding);
 const snapshot={plan,evidence:[],pending:[],issues:[],blockers:[{transactionAccountId:'90000000000000001',channelId:'7',blockedStepIds:['send03','receive04']}]};
 const {compareConfirmedExpectations}=await import('../src/case-result-graph.js');
 assert.equal(compareConfirmedExpectations(snapshot).outcome,'FAIL');assert.equal(compareConfirmedExpectations(snapshot).unavailableExpectations.length,2);
 const independent=structuredClone(snapshot);independent.plan.contract.expectations.push({...holding,selector:{...holding.selector,fundCode:'000002'}});assert.equal(compareConfirmedExpectations(independent).outcome,'REVIEW');
 const evidence={id:'app',source:{kind:'APPLICATION_CONFIRMATION',fileType:'03',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',status:'CONFIRMED'}};
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[evidence,evidence]}).outcome,'REVIEW');
 assert.equal(compareConfirmedExpectations({...snapshot,evidence:[{...evidence,values:{...evidence.values,status:null}}]}).outcome,'REVIEW');
 const sharedSelector=structuredClone(snapshot);sharedSelector.plan.exchangePlan.steps.push({...sharedSelector.plan.exchangePlan.steps[0],stepId:'independent03',roundId:'another',required:false});sharedSelector.plan.contract.applications.push({...sharedSelector.plan.contract.applications[0],key:'independent',stepId:'independent03'});assert.equal(compareConfirmedExpectations(sharedSelector).outcome,'REVIEW');
});

test('unresolved/truncated dependency diagnostics evaluate when no necessary action can run, while independent required paths continue',async()=>{
 const {workflowPosition}=await import('../src/durable-workflow.js');
 const order={plan:{steps:[{stepId:'send03',direction:'SEND',fileType:'03',required:true,dependsOn:[{stepId:'failed02',condition:'CONFIRMED'}]}]},events:[{stepId:'failed02',condition:'APPLIED'}],reviewRequired:true,reviewIssues:['映射不唯一']};
 const facts={chatStatus:'ACTIVE',caseStatus:'EXECUTING',plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order,review:{confirmable:false}};
 assert.equal(workflowPosition(facts).stage,'EVALUATE_RESULT');
 order.plan.steps.push({stepId:'optional05',direction:'RECEIVE',fileType:'05',required:false,dependsOn:[]});assert.equal(workflowPosition(facts).stage,'EVALUATE_RESULT');
 order.plan.steps[1].required=true;assert.equal(workflowPosition(facts).stage,'FILE_EXCHANGE');assert.equal(workflowPosition(facts).waiting[0].stepId,'optional05');
 order.plan.steps[1].required=false;order.plan.steps[0].dependsOn=[{stepId:'optional05',condition:'CONFIRMED'}];assert.equal(workflowPosition(facts).stage,'FILE_EXCHANGE');
});

test('confirmation readiness revalidates persisted suggestions with current deterministic rules without a model',async()=>{
 const {planContract}=await import('./plan-contract-fixture.js'),{exchangePlan}=await import('./exchange-plan-fixture.js');
 const {canConfirmCaseResult}=await import('../src/case-result-graph.js');
 const plan={exchangePlan,scenarios:[{expected:'状态CONFIRMED'}]};plan.contract=planContract(plan);
 const snapshot={plan,evidence:[],pending:[],issues:[]};
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL'}),false);
 const evidence={id:'app',source:{kind:'APPLICATION_CONFIRMATION',fileType:'03',businessDate:'20261006'},values:{transactionAccountId:'90000000000000001',status:'CONFIRMED'}};
 snapshot.evidence=[evidence];assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS'}),true);assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL'}),false);
 evidence.values.status='FAILED';assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL'}),true);assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS'}),false);
 snapshot.evidence=[];snapshot.blockers=[{transactionAccountId:'90000000000000001',channelId:'7',blockedStepIds:['send03','receive04']}];assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL'}),true);
 snapshot.pending=['其他必需分支未完成'];assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL'}),false);
});


test('legacy confirmation rechecks saved assertions using current evidence and literal rules',async()=>{
 const {canConfirmCaseResult}=await import('../src/case-result-graph.js');
 const snapshot={plan:{scenarios:[{expected:'确认份额100份'}]},evidence:[{id:'holding',source:{kind:'FORMAL_HOLDING'},values:{confirmedVolume:'100'}}],pending:[],issues:[]};
 const check={scenarioIndex:0,expectedQuote:'确认份额100份',evidenceId:'holding',field:'confirmedVolume',operator:'eq',expectedValue:'100'};
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS',checks:[check]}),true);
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS',checks:[check],uncertainties:['未解决']}),false);
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS',checks:[check],issues:['证据未完整']}),false);
 snapshot.evidence[0].values.confirmedVolume='90';
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'PASS',checks:[check]}),false);
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL',checks:[check]}),true);
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL',checks:[{...check,expectedValue:'10'}]}),false);
 assert.equal(canConfirmCaseResult(snapshot,{outcome:'FAIL',checks:[]}),false);
});
