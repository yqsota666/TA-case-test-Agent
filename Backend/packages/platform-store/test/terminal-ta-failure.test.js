import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTerminalTaFailures,unresolvedTerminalTaFailures,terminalTaFailures} from '../src/terminal-ta-failure.js';
import {workflowPosition} from '../../case-agent/src/durable-workflow.js';
const steps=[
 {stepId:'open',fileType:'01',direction:'SEND',required:true,dependsOn:[]},
 {stepId:'account',fileType:'02',direction:'RECEIVE',required:true,dependsOn:[{stepId:'open',condition:'SENT'}]},
 {stepId:'purchase',fileType:'03',direction:'SEND',required:true,dependsOn:[{stepId:'account',condition:'CONFIRMED'}]},
 {stepId:'confirmation',fileType:'04',direction:'RECEIVE',required:true,dependsOn:[{stepId:'purchase',condition:'SENT'}]},
];
const fixture=()=>({plan:{contract:{applications:[{stepId:'purchase',accountIndex:0,transactionAccountId:null}]}},
 order:{plan:{steps:structuredClone(steps)},events:[{stepId:'open',condition:'SENT'},{stepId:'account',condition:'PARSED'},{stepId:'account',condition:'APPLIED'}]},
 preparedAccounts:[{transactionAccountId:'90000000000000001'}],applications:[],
 failures:[{stepId:'account',applicationId:'1',parseId:'2',batchId:'3',channelId:'4',returnCode:'1001',record:{TransactionAccountID:'90000000000000001'},confirmation:{TransactionAccountID:'90000000000000001'}}]});
test('applied terminal failure identifies only mandatory same-account descendants without faking completion',()=>{
 const f=fixture(),blockers=deriveTerminalTaFailures(f);assert.deepEqual(blockers[0].blockedStepIds,['confirmation','purchase']);
 f.order.blockers=blockers;
 const facts={chatStatus:'ACTIVE',caseStatus:'EXECUTING',plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:f.order};
 assert.equal(workflowPosition(facts).stage,'EVALUATE_RESULT');
 assert.equal(f.order.events.some(e=>e.stepId==='account'&&e.condition==='CONFIRMED'),false);
 assert.equal(f.order.events.some(e=>e.stepId==='purchase'),false);
});
test('unapplied, another account and already sent target cannot create a terminal blocker',()=>{
 for(const change of [f=>{f.failures=[];},f=>{f.preparedAccounts[0].transactionAccountId='90000000000000002';},f=>{f.order.events.push({stepId:'purchase',condition:'SENT'});},f=>{f.failures[0].confirmation.TransactionAccountID='90000000000000002';}]){
  const f=fixture();change(f);assert.deepEqual(deriveTerminalTaFailures(f),[]);
 }
});
test('an unaffected required branch remains in FILE_EXCHANGE while optional branches do not become blocked',()=>{
 const f=fixture();f.order.plan.steps.push({stepId:'independent05',fileType:'05',direction:'RECEIVE',required:true,dependsOn:[]},{stepId:'optional03',fileType:'03',direction:'SEND',required:false,dependsOn:[{stepId:'account',condition:'CONFIRMED'}]});
 f.order.blockers=deriveTerminalTaFailures(f);assert.deepEqual(f.order.blockers[0].blockedStepIds,['confirmation','purchase']);
 const position=workflowPosition({chatStatus:'ACTIVE',caseStatus:'EXECUTING',plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:f.order});
 assert.equal(position.stage,'FILE_EXCHANGE');assert.equal(position.waiting.some(s=>s.stepId==='independent05'),true);
});
test('legacy plans require a persisted same-step same-account application rather than guessing from one draft',()=>{
 const f=fixture();delete f.plan.contract;assert.deepEqual(deriveTerminalTaFailures(f),[]);
 f.applications=[{stepId:'purchase',fileType:'03',record:{TransactionAccountID:'90000000000000001'}}];assert.equal(deriveTerminalTaFailures(f).length,1);
 f.applications.push({stepId:'purchase',fileType:'03',record:{TransactionAccountID:'90000000000000002'}});assert.deepEqual(deriveTerminalTaFailures(f),[]);
});
test('a final failed TA step with no unreachable required successor remains a normal terminal receipt',()=>{
 const f=fixture();f.order.plan.steps=f.order.plan.steps.slice(0,2);assert.deepEqual(deriveTerminalTaFailures(f),[]);
 assert.equal(workflowPosition({chatStatus:'ACTIVE',caseStatus:'EXECUTING',plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:f.order}).stage,'EVALUATE_RESULT');
});

test('different accounts sharing a planned SEND step do not allow one failure to seal all accounts',()=>{
 const f=fixture();f.plan.contract.applications.push({stepId:'purchase',accountIndex:null,transactionAccountId:'90000000000000002'});assert.deepEqual(deriveTerminalTaFailures(f),[]);
});

test('a mixed receipt success marker does not hide a concrete failed account, while ambiguous mixed SEND mapping requires review',()=>{
 const f=fixture();f.order.events.push({stepId:'account',condition:'CONFIRMED'});assert.equal(deriveTerminalTaFailures(f).length,1);
 f.plan.contract.applications.push({stepId:'purchase',accountIndex:null,transactionAccountId:'90000000000000002'});assert.deepEqual(deriveTerminalTaFailures(f),[]);assert.equal(unresolvedTerminalTaFailures(f).length,1);
});

test('optional source on an explicit mandatory dependency remains a blocker; an entirely optional path does not',()=>{
 const f=fixture();f.order.plan.steps[1].required=false;assert.equal(deriveTerminalTaFailures(f).length,1);
 f.plan.contract.applications.push({stepId:'purchase',accountIndex:null,transactionAccountId:'90000000000000002'});assert.equal(unresolvedTerminalTaFailures(f).length,1);
 f.order.plan.steps[2].required=false;f.order.plan.steps[3].required=false;assert.deepEqual(deriveTerminalTaFailures(f),[]);assert.deepEqual(unresolvedTerminalTaFailures(f),[]);
});

test('optional bridge application becomes necessary only when its required successor depends on it',()=>{
 const f=fixture();f.order.plan.steps[1].required=false;f.order.plan.steps[2].required=false;const blockers=deriveTerminalTaFailures(f);assert.deepEqual(blockers[0].blockedStepIds,['confirmation','purchase']);f.order.blockers=blockers;
 assert.equal(workflowPosition({chatStatus:'ACTIVE',caseStatus:'EXECUTING',plan:{status:'LOCKED'},generated:true,draftConfirmed:true,order:f.order}).stage,'EVALUATE_RESULT');
 f.order.plan.steps[3].required=false;assert.deepEqual(deriveTerminalTaFailures(f),[]);assert.deepEqual(unresolvedTerminalTaFailures(f),[]);
});

test('500 complete failure/application rows retain mappings; either 501-row sentinel refuses partial derivation',async()=>{
 const f=fixture(),keys=[7,8,9];f.order.version=1;
 const failures=Array.from({length:500},(_,i)=>({...f.failures[0],applicationId:String(i+1)}));
 const applications=Array.from({length:500},(_,i)=>({stepId:'purchase',fileType:'03',applicationId:String(1000+i),record:{TransactionAccountID:'90000000000000001'}}));
 const read=async(failedRows,appRows)=>terminalTaFailures({execute:async(sql,args)=>{assert.deepEqual(args,[...keys,1]);return [sql.includes('JOIN sales_return_confirmations')?failedRows:appRows];}},keys,{plan:f.plan,order:f.order,preparedAccounts:f.preparedAccounts,write:true});
 const complete=await read(failures,applications);assert.equal(complete.truncated,false);assert.equal(complete.blockers.length,500);assert.equal(complete.blockers[0].blockedApplicationIds.length,500);
 for(const [failedRows,appRows] of [[failures.concat({record:null}),applications],[failures,applications.concat({record:null})]]){
  const truncated=await read(failedRows,appRows);assert.equal(truncated.truncated,true);assert.deepEqual(truncated.blockers,[]);assert.deepEqual(truncated.unresolvedFailures,[]);
 }
});
