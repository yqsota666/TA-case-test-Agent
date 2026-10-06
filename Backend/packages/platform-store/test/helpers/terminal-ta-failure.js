import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validPlanContract} from '../../../platform-protocol/src/plan-contract.js';
import {createCaseResultGraph} from '../../../case-agent/src/case-result-graph.js';
import {workflowPosition} from '../../../case-agent/src/durable-workflow.js';
import {createCaseResultRepository} from '../../src/case-result.js';
import {workflowFacts,createDurableWorkflowRepository} from '../../src/durable-workflow.js';
import {createCaseRepository} from '../../src/index.js';
import {createChatLifecycleRepository} from '../../src/chat-lifecycle.js';
const json=v=>typeof v==='string'?JSON.parse(v):v;
export async function verifyTerminalTaFailure({db,transaction,token,scope,channelId,parseId,applyFailure,confirmations,exchange}){
 const [[row]]=await db.execute('SELECT k.workspace_id,k.chat_id,k.id AS case_id,k.status AS case_status,c.status AS chat_status,s.plan_json FROM cases k JOIN case_chats c ON c.workspace_id=k.workspace_id AND c.id=k.chat_id JOIN case_sop_versions s ON s.workspace_id=k.workspace_id AND s.chat_id=k.chat_id AND s.case_id=k.id AND s.version_number=1 WHERE k.public_id=?',[scope.casePublicId]);
 const keys=[row.workspace_id,row.chat_id,row.case_id];
 const [[execution]]=await db.execute('SELECT specification_json FROM case_data_executions WHERE workspace_id=? AND chat_id=? AND case_id=?',keys);
 const plan={objective:'合成开户失败阻断后续申购',preconditions:['TA业务结果必须用户应用才成为终态'],openQuestions:[],exchangePlan:json(row.plan_json).exchangePlan,
  scenarios:[{title:'开户后申购',setup:'合成新账户',action:'01/02成功后03/04',expected:'开户申请状态为CONFIRMED；申购申请状态为CONFIRMED；确认金额100元；确认份额100份；总份额100份',evidence:'02/04原文和正式持仓'}]};
 const selector=(fileType,businessDate,fundCode=null,shareClass=null)=>({accountIndex:0,transactionAccountId:null,channelId,fileType,businessDate,fundCode,shareClass});
 plan.contract={version:1,protocolVersion:'22',dataSpecification:json(execution.specification_json),assumptions:['合成测试，无真实TA连接'],missing:[],
 applications:[{key:'opening',stepId:'s01_1',businessCode:'001',accountIndex:0,transactionAccountId:null,fundIndex:null,fields:{TransactionTime:'120000',CertificateType:'0',CertificateNo:'S'.repeat(40)}},
 {key:'purchase',stepId:'s03_1',businessCode:'022',accountIndex:0,transactionAccountId:null,fundIndex:0,fields:{TransactionTime:'120000',ApplicationAmount:'100.00',CurrencyType:'156',ChargeType:'0'}}],
 expectations:[{scenarioIndex:0,expectedQuote:'开户申请状态为CONFIRMED',source:'APPLICATION_CONFIRMATION',selector:selector('01','20261006'),field:'status',operator:'eq',expectedValue:'CONFIRMED'},
 {scenarioIndex:0,expectedQuote:'申购申请状态为CONFIRMED',source:'APPLICATION_CONFIRMATION',selector:selector('03','20261007','000001','0'),field:'status',operator:'eq',expectedValue:'CONFIRMED'},
 ...[['confirmedAmount','确认金额100元'],['confirmedVolume','确认份额100份']].map(([field,expectedQuote])=>({scenarioIndex:0,expectedQuote,source:'APPLICATION_CONFIRMATION',selector:selector('03','20261007','000001','0'),field,operator:'eq',expectedValue:'100'})),
 {scenarioIndex:0,expectedQuote:'总份额100份',source:'CURRENT_FORMAL_HOLDING',selector:selector(null,null,'000001','0'),field:'totalVolume',operator:'eq',expectedValue:'100'}]};
 if(process.env.CASE_TERMINAL_BRIDGE==='1'){plan.exchangePlan.steps.find(s=>s.stepId==='r02_1').required=false;plan.exchangePlan.steps.find(s=>s.stepId==='s03_1').required=false;}
 assert.equal(validPlanContract(plan.contract,plan),true);
 // Convert this isolated fixture's equivalent already-locked schedule to the strict shape before receiving its terminal business effect.
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE workspace_id=? AND chat_id=? AND case_id=? AND version_number=1',[JSON.stringify(plan),...keys]);
 const results=createCaseResultRepository({transaction}),facts=()=>workflowFacts(db,{owner:row,keys},token,scope);
 const nativePool={getConnection:async()=>({execute:db.execute.bind(db),beginTransaction:()=>db.query('SAVEPOINT terminal_workflow'),commit:()=>db.query('RELEASE SAVEPOINT terminal_workflow'),rollback:()=>db.query('ROLLBACK TO SAVEPOINT terminal_workflow'),release:()=>{}})};
 const readNative=()=>createDurableWorkflowRepository({pool:nativePool}).read(token,scope);
 const before=await results.snapshot(token,scope);assert.equal(before.blockers,undefined);assert.ok(before.pending.length);assert.equal(workflowPosition(await facts()).stage,'FILE_EXCHANGE');assert.equal((await readNative()).stage,'FILE_EXCHANGE');
 const salesBefore=await confirmations.salesData(token),failed=await applyFailure();assert.equal(failed.results[0].outcome,'FAILED');
 const snapshot=await results.snapshot(token,scope);assert.deepEqual(snapshot.pending,[]);assert.deepEqual(snapshot.issues,[]);assert.equal(snapshot.blockers.length,1);assert.deepEqual(snapshot.blockers[0].blockedStepIds,['r04_1','s03_1']);
 assert.equal(snapshot.blockers[0].parseId,parseId);assert.equal(workflowPosition(await facts()).stage,'EVALUATE_RESULT');assert.equal((await readNative()).stage,'EVALUATE_RESULT');
 const [[confirmed]]=await db.execute("SELECT COUNT(*) AS n FROM case_exchange_plan_events WHERE workspace_id=? AND chat_id=? AND case_id=? AND step_id='r02_1' AND condition_name='CONFIRMED'",keys);assert.equal(Number(confirmed.n),0);
 const state=await createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('no model is needed for proven TA dependency failure');}}).invoke({});assert.equal(state.suggestion.outcome,'FAIL');assert.equal(state.suggestion.checks.length,1);assert.equal(state.suggestion.checks[0].actualValue,'FAILED');assert.equal(state.suggestion.checks[0].expectedValue,'CONFIRMED');assert.equal(state.suggestion.checks[0].matched,false);
 const reviews=[];for(let i=0;i<11;i++)reviews.push(await results.save(token,scope,state));
 const saved=reviews.at(-1),stale=reviews.find(r=>r.reviewId==='9')??reviews.at(-2);
 if(process.env.CASE_TERMINAL_BRIDGE!=='1'){assert.ok(reviews.some(r=>r.reviewId==='9'));assert.ok(reviews.some(r=>r.reviewId==='10'));assert.equal(saved.reviewId,'11');}
 assert.equal((await results.read(token,scope)).reviewId,saved.reviewId);
 const latestFacts=await facts();assert.equal(latestFacts.review.id,saved.reviewId);assert.equal(workflowPosition(latestFacts).stage,'CONFIRM_RESULT');const native=await readNative();assert.equal(native.stage,'CONFIRM_RESULT');assert.equal(native.revision,latestFacts.revision);
 await assert.rejects(results.confirm(token,{...scope,reviewId:stale.reviewId,verdict:'FAIL',reason:'合成旧9版不能覆盖新版11'}),{code:'REVIEW_SUPERSEDED'});
 await assert.rejects(results.confirm(token,{...scope,reviewId:saved.reviewId,verdict:'PASS',reason:'合成禁止假通过'}),{code:'TERMINAL_TA_FAILURE_REQUIRES_FAIL'});
 await db.query('SAVEPOINT terminal_source');await db.execute('UPDATE case_return_parse_files SET raw_bytes=CONCAT(raw_bytes,?) WHERE workspace_id=? AND chat_id=? AND case_id=? AND parse_id=?',[Buffer.from('x'),...keys,parseId]);
 await assert.rejects(results.confirm(token,{...scope,reviewId:saved.reviewId,verdict:'FAIL',reason:'合成失效证据不得确认'}),{code:'CASE_RESULT_CHANGED'});await db.query('ROLLBACK TO SAVEPOINT terminal_source');
 assert.equal((await results.confirm(token,{...scope,reviewId:saved.reviewId,verdict:'FAIL',reason:'合成02业务失败，03/04无法执行'})).finalVerdict,'FAIL');
 const next=await createChatLifecycleRepository({transaction}).retest(token,{...scope,requestId:crypto.randomUUID(),reason:'合成修正后重新讨论'});assert.equal(next.chatPublicId,scope.chatPublicId);assert.notEqual(next.casePublicId,scope.casePublicId);
 const [[child]]=await db.execute('SELECT status FROM cases WHERE public_id=?',[next.casePublicId]);assert.equal(child.status,'DISCUSSING');
 const context=await createCaseRepository({transaction}).readCaseDiscussion(token,scope.chatPublicId,next.casePublicId);assert.equal(context.sourceContext.suggestion.outcome,'FAIL');assert.equal(context.sourceContext.suggestion.blockers[0].parseId,parseId);assert.equal(context.sourceContext.contextIsReadOnly,true);assert.equal(context.sourceContext.evidence.some(e=>e.source.kind==='TA_DEPENDENCY_FAILURE'),true);
 assert.deepEqual(await confirmations.salesData(token),salesBefore);assert.equal((await exchange.listCaseApplications(token,scope)).applications.length,1);
 return failed;
}
