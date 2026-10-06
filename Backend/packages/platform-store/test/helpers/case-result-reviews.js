import assert from 'node:assert/strict';
import {createCaseResultRepository} from '../../src/case-result.js';
import {createCaseResultService} from '../../../case-api/src/case-result.js';
export async function verifyCaseResultReviews({db,transaction,token,scope,workspaceId}){
 const [[planRow]]=await db.execute(`SELECT s.id,s.plan_json,k.id AS case_id FROM case_sop_versions s JOIN cases k ON k.workspace_id=s.workspace_id AND k.chat_id=s.chat_id AND k.id=s.case_id WHERE k.public_id=? AND s.status='LOCKED'`,[scope.casePublicId]);
 const previous=typeof planRow.plan_json==='string'?JSON.parse(planRow.plan_json):planRow.plan_json;
 const plan={...previous,exchangePlan:{...previous.exchangePlan,steps:previous.exchangePlan.steps.map(s=>({...s,required:false}))},objective:'核验正式余额',preconditions:[],openQuestions:[],scenarios:[{title:'余额',setup:'已确认账户',action:'接收05',expected:'总份额700份',evidence:'正式余额'}]};
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(plan),planRow.id]);
 const repository=createCaseResultRepository({transaction});const initial=await repository.snapshot(token,scope);
 assert.equal(initial.pending.length,0);assert.equal(initial.issues.length,0);
 const holding=initial.evidence.find(e=>e.values.fundCode==='000001' && e.values.totalVolume==='700.00');assert.ok(holding);
 const complete=async()=>JSON.stringify({assertions:[{scenarioIndex:0,expectedQuote:'总份额700份',evidenceId:holding.id,field:'totalVolume',operator:'eq',expectedValue:'700'}],uncertainties:[]});
 const changing=createCaseResultService({repository,complete:async()=>{
  await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='699.00' WHERE workspace_id=? AND account_id=? AND fund_code='000001'`,[workspaceId,holding.values.accountId]);
  return complete();
 }});
 await assert.rejects(changing.evaluate(token,scope),{code:'CASE_RESULT_CHANGED'});
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='700.00' WHERE workspace_id=? AND account_id=? AND fund_code='000001'`,[workspaceId,holding.values.accountId]);
 const service=createCaseResultService({repository,complete});
 const first=await service.evaluate(token,scope);assert.equal(first.suggestion.outcome,'PASS');
 const [[before]]=await db.execute('SELECT status FROM cases WHERE id=?',[planRow.case_id]);assert.equal(before.status,'SOP_LOCKED');
 const key=[workspaceId,holding.values.accountId,'000001'];
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='690.00' WHERE workspace_id=? AND account_id=? AND fund_code=?`,key);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:first.reviewId,verdict:'PASS',reason:'旧快照'}),{code:'CASE_RESULT_CHANGED'});
 const fail=await service.evaluate(token,scope);assert.equal(fail.suggestion.outcome,'FAIL');
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='700.00' WHERE workspace_id=? AND account_id=? AND fund_code=?`,key);
 const latest=await service.evaluate(token,scope);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:fail.reviewId,verdict:'FAIL',reason:'旧版本'}),{code:'REVIEW_SUPERSEDED'});
 await db.query('SAVEPOINT result_final');
 assert.equal((await repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'人工核对余额'})).finalVerdict,'PASS');
 assert.equal((await repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'重复'})).duplicate,true);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'FAIL',reason:'覆盖'}),{code:'VERDICT_CONFLICT'});
 await db.query('ROLLBACK TO SAVEPOINT result_final');
 const unclear=createCaseResultService({repository,complete:async()=>JSON.stringify({assertions:[],uncertainties:['预期不清楚']})});
 const review=await unclear.evaluate(token,scope);assert.equal(review.suggestion.outcome,'REVIEW');
 await assert.rejects(repository.confirm(token,{...scope,reviewId:review.reviewId,verdict:'PASS',reason:'不能跳过澄清'}),{code:'RESULT_NOT_READY'});
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(previous),planRow.id]);
}
