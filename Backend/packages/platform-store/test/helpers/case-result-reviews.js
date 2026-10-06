import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {parseDataFile,buildIndexFile} from '../../../platform-protocol/src/index.js';
import {createCaseResultRepository} from '../../src/case-result.js';
import {createCaseResultService} from '../../../case-api/src/case-result.js';
export async function verifyCaseResultReviews({db,transaction,token,scope,workspaceId}){
 const [[planRow]]=await db.execute(`SELECT s.id,s.plan_json,k.id AS case_id FROM case_sop_versions s JOIN cases k ON k.workspace_id=s.workspace_id AND k.chat_id=s.chat_id AND k.id=s.case_id WHERE k.public_id=? AND s.status='LOCKED'`,[scope.casePublicId]);
 const previous=typeof planRow.plan_json==='string'?JSON.parse(planRow.plan_json):planRow.plan_json;
 const plan={...previous,exchangePlan:{...previous.exchangePlan,steps:previous.exchangePlan.steps.map(s=>({...s,required:false}))},objective:'核验正式余额',preconditions:[],openQuestions:[],scenarios:[{title:'余额',setup:'已确认账户',action:'接收05',expected:'总份额700份',evidence:'正式余额'}]};
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(plan),planRow.id]);
 const sourceReads=[];
 const observedTransaction=work=>transaction(connection=>work(new Proxy(connection,{get(target,key){
  if(key==='execute')return async(sql,values)=>{
   if(sql.includes('FROM case_holdings_return_files'))sourceReads.push(sql);
   return target.execute(sql,values);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }})));
 const repository=createCaseResultRepository({transaction:observedTransaction});const initial=await repository.snapshot(token,scope);
 assert.equal(initial.pending.length,0);assert.equal(initial.issues.length,0);
 const holding=initial.evidence.find(e=>e.values.fundCode==='000001' && e.values.totalVolume==='700.00');assert.ok(holding);
 plan.scenarios[0].expected=`账号${holding.values.transactionAccountId}，基金代码000001，份额类别${holding.values.shareClass}，总份额700份`;
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(plan),planRow.id]);
 // Missing source must never be silently accepted merely because remaining file hashes match.
 await db.query('SAVEPOINT missing_case_result_source');
 const [sourceFiles]=await db.execute('SELECT parse_id,file_name FROM case_holdings_return_files WHERE case_id=? LIMIT 1',[planRow.case_id]);
 assert.ok(sourceFiles.length);
 await db.execute('DELETE FROM case_holdings_return_files WHERE case_id=? AND parse_id=? AND file_name=?',[planRow.case_id,sourceFiles[0].parse_id,sourceFiles[0].file_name]);
 assert.ok((await repository.snapshot(token,scope)).issues.some(message=>message.includes('原始TA文件包缺失')));
 const incompleteService=createCaseResultService({repository,complete:async()=>{throw Error('model must not judge incomplete raw evidence');}});
 assert.equal((await incompleteService.evaluate(token,scope)).suggestion.outcome,'REVIEW');
 await db.query('ROLLBACK TO SAVEPOINT missing_case_result_source');
 await db.query('SAVEPOINT source_package_cases');
 const [[source]]=await db.execute(`SELECT workspace_id,chat_id,case_id,parse_id,file_name,content_sha256,raw_bytes
   FROM case_holdings_return_files WHERE case_id=? LIMIT 1`,[planRow.case_id]);
 const wire=parseDataFile(source.raw_bytes);
 const shardName=source.file_name.replace(/(?:_\d{3})?\.TXT$/,'_998.TXT');
 const insertFile=async(name,bytes)=>db.execute(`INSERT INTO case_holdings_return_files
  (workspace_id,chat_id,case_id,parse_id,file_name,content_sha256,raw_bytes) VALUES (?,?,?,?,?,?,?)`,
  [source.workspace_id,source.chat_id,source.case_id,source.parse_id,name,crypto.createHash('sha256').update(bytes).digest('hex'),bytes]);
 await insertFile(shardName,source.raw_bytes);
 const updatePackageHash=async()=>{
  const [rows]=await db.execute('SELECT file_name,content_sha256 FROM case_holdings_return_files WHERE parse_id=?',[source.parse_id]);
  const entries=rows.map(row=>[row.file_name,row.content_sha256]).sort((a,b)=>a[0].localeCompare(b[0]));
  await db.execute('UPDATE case_holdings_return_parses SET content_sha256=? WHERE id=?',[crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex'),source.parse_id]);
 };
 await updatePackageHash();
 assert.equal((await repository.snapshot(token,scope)).issues.length,0);
 await db.query('SAVEPOINT complete_no_index_shards');
 await db.execute('DELETE FROM case_holdings_return_files WHERE parse_id=? AND file_name=?',[source.parse_id,shardName]);
 assert.ok((await repository.snapshot(token,scope)).issues.some(message=>message.includes('原始TA文件包缺失')));
 assert.equal((await incompleteService.evaluate(token,scope)).suggestion.outcome,'REVIEW');
 await db.query('ROLLBACK TO SAVEPOINT complete_no_index_shards');
 const indexName=`OFI_${wire.creator}_${wire.receiver}_${wire.date}.TXT`;
 await insertFile(indexName,buildIndexFile({...wire,fileNames:[source.file_name,shardName]}));
 await updatePackageHash();
 await db.execute("DELETE FROM case_holdings_return_files WHERE parse_id=? AND file_name LIKE 'OFD_%'",[source.parse_id]);
 assert.ok((await repository.snapshot(token,scope)).issues.some(message=>message.includes('原始TA文件包缺失')));
 assert.equal((await incompleteService.evaluate(token,scope)).suggestion.outcome,'REVIEW');
 await db.query('ROLLBACK TO SAVEPOINT source_package_cases');
 const complete=async()=>JSON.stringify({assertions:[{scenarioIndex:0,expectedQuote:plan.scenarios[0].expected,evidenceId:holding.id,field:'totalVolume',operator:'eq',expectedValue:'700'}],uncertainties:[]});
 const changing=createCaseResultService({repository,complete:async()=>{
  await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='699.00' WHERE workspace_id=? AND account_id=? AND fund_code='000001'`,[workspaceId,holding.values.accountId]);
  return complete();
 }});
 await assert.rejects(changing.evaluate(token,scope),{code:'CASE_RESULT_CHANGED'});
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='700.00' WHERE workspace_id=? AND account_id=? AND fund_code='000001'`,[workspaceId,holding.values.accountId]);
 const service=createCaseResultService({repository,complete});
 sourceReads.length=0;
 const first=await service.evaluate(token,scope);assert.equal(first.suggestion.outcome,'PASS');
 assert.ok(sourceReads.some(sql=>sql.endsWith(' FOR UPDATE')),'saving a review must read latest locked raw holdings sources');
 const [[before]]=await db.execute('SELECT status FROM cases WHERE id=?',[planRow.case_id]);assert.equal(before.status,'SOP_LOCKED');
 const key=[workspaceId,holding.values.accountId,'000001'];
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='690.00' WHERE workspace_id=? AND account_id=? AND fund_code=?`,key);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:first.reviewId,verdict:'PASS',reason:'旧快照'}),{code:'CASE_RESULT_CHANGED'});
 const fail=await service.evaluate(token,scope);assert.equal(fail.suggestion.outcome,'FAIL');
 await db.execute(`UPDATE sales_confirmed_holdings SET total_volume='700.00' WHERE workspace_id=? AND account_id=? AND fund_code=?`,key);
 const latest=await service.evaluate(token,scope);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:fail.reviewId,verdict:'FAIL',reason:'旧版本'}),{code:'REVIEW_SUPERSEDED'});
 await db.query('SAVEPOINT result_final');sourceReads.length=0;
 assert.equal((await repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'人工核对余额'})).finalVerdict,'PASS');
 assert.ok(sourceReads.some(sql=>sql.endsWith(' FOR UPDATE')),'confirming a review must read latest locked raw holdings sources');
 assert.equal((await repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'PASS',reason:'重复'})).duplicate,true);
 await assert.rejects(repository.confirm(token,{...scope,reviewId:latest.reviewId,verdict:'FAIL',reason:'覆盖'}),{code:'VERDICT_CONFLICT'});
 await db.query('ROLLBACK TO SAVEPOINT result_final');
 const unclear=createCaseResultService({repository,complete:async()=>JSON.stringify({assertions:[],uncertainties:['预期不清楚']})});
 const review=await unclear.evaluate(token,scope);assert.equal(review.suggestion.outcome,'REVIEW');
 await assert.rejects(repository.confirm(token,{...scope,reviewId:review.reviewId,verdict:'PASS',reason:'不能跳过澄清'}),{code:'RESULT_NOT_READY'});
 await db.execute('UPDATE case_sop_versions SET plan_json=? WHERE id=?',[JSON.stringify(previous),planRow.id]);
}
