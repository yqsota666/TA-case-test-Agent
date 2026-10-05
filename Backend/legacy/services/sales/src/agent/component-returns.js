import {componentOutput,componentAccount} from './component-data.js';
import {checkSnapshot,isoDate} from './plans.js';
import {units} from '../platform/workflow-service.js';

export async function receiveReturn(ctx,step) {
  const p=step.params;
  if(p.fileType==='05')return receiveSnapshot(ctx,step);
  const confirmations=[],missing=[];
  for(const id of p.applicationStepIds){
    const app=componentOutput(ctx,id).application;
    const [rows]=await ctx.db.execute(`SELECT c.*,f.record_json,f.match_reason AS local_note FROM confirmations c
      JOIN file_records f ON f.workspace_id=c.workspace_id AND f.chat_id=c.chat_id AND f.run_id=c.run_id AND f.id=c.file_record_id
      WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.application_id=? AND c.file_type=? ORDER BY c.id DESC`,
      [...ctx.keys,app.id,p.fileType]);
    const final=rows.find(c=>c.outcome==='FAILURE'||(c.outcome==='SUCCESS'&&(c.business_finish_flag==null||c.business_finish_flag==='1')));
    if(!final){missing.push({stepId:id,applicationId:app.id,appNo:app.appNo,partial:rows.length>0});continue;}
    confirmations.push({stepId:id,confirmationId:String(final.id),applicationId:String(app.id),outcome:final.outcome,
      returnCode:final.return_code,confirmationDate:isoDate(final.confirmation_date),taSerialNo:final.record_json.TASerialNO??null,
      localNote:final.local_note??null});
  }
  if(missing.length)return {ok:true,waiting:true,wait:{category:'RETURN',reason:'等待外部TA最终确认',fileTypes:[p.fileType],
    missing,received:confirmations,uploadUrl:'/api/returns'}};
  return {ok:true,confirmations};
}

async function receiveSnapshot(ctx,step) {
  const p=step.params,account=await componentAccount(ctx,p.accountStepId);
  const snapshot=ctx.facts.snapshots.find(s=>String(s.trading_account_id)===String(account.trading_account_id)
    &&s.fund_code===p.fundCode&&s.share_class===p.shareClass&&s.branch_code===account.branch_code);
  const related=ctx.facts.confirmationSources.filter(c=>String(c.trading_account_id)===String(account.trading_account_id)
    &&c.fund_code===p.fundCode&&c.share_class===p.shareClass&&c.branch_code===account.branch_code);
  const minimum=[p.snapshotDate??'',...related.map(c=>isoDate(c.confirmation_date))].sort().at(-1);
  if(!snapshot||isoDate(snapshot.snapshot_date)<minimum||related.some(c=>isoDate(c.confirmation_date)===isoDate(snapshot.snapshot_date)&&BigInt(c.file_record_id)>BigInt(snapshot.file_record_id)))
    return {ok:true,waiting:true,wait:{category:'RETURN',reason:'等待相关业务完成后的05',fileTypes:['05'],
      tradingAccountId:String(account.trading_account_id),fundCode:p.fundCode,shareClass:p.shareClass,minimumDate:minimum,uploadUrl:'/api/returns'}};
  return {ok:true,snapshotId:String(snapshot.id),snapshotDate:isoDate(snapshot.snapshot_date)};
}

export async function validateResult(ctx,step) {
  const received=componentOutput(ctx,step.params.receiveStepId),failures=[];
  for(const expected of step.params.expectations){
    const evidence=received.confirmations.find(c=>c.stepId===expected.applicationStepId);
    const [[conflict]]=await ctx.db.execute(`SELECT COUNT(*) AS n FROM file_records WHERE workspace_id=? AND chat_id=? AND run_id=?
      AND application_id=? AND match_status='CONFLICT'`,[...ctx.keys,evidence.applicationId]);
    if(Number(conflict.n))return {ok:false,componentStatus:'REVIEW',reason:'该申请存在未解决的回传冲突'};
    const [[latest]]=await ctx.db.execute(`SELECT c.outcome,c.return_code,f.record_json,f.match_reason AS local_note
      FROM confirmations c JOIN file_records f ON f.workspace_id=c.workspace_id AND f.chat_id=c.chat_id AND f.run_id=c.run_id AND f.id=c.file_record_id
      WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.application_id=?
      AND (c.outcome='FAILURE' OR (c.outcome='SUCCESS' AND (c.business_finish_flag IS NULL OR c.business_finish_flag='1')))
      ORDER BY c.id DESC LIMIT 1`,[...ctx.keys,evidence.applicationId]);
    const actual={outcome:latest?.outcome,returnCode:latest?.return_code};
    if(latest?.local_note)return {ok:false,componentStatus:'REVIEW',reason:latest.local_note};
    if(actual.outcome!==expected.outcome||expected.returnCodes.length&&!expected.returnCodes.includes(actual.returnCode))
      failures.push({stepId:expected.applicationStepId,expected:expected.outcome,actual:actual.outcome,returnCode:actual.returnCode});
    if(Object.keys(expected.fields).length){
      for(const [field,value]of Object.entries(expected.fields))if(String(latest?.record_json[field]??'')!==value)
        failures.push({stepId:expected.applicationStepId,field,expected:value,actual:latest?.record_json[field]??null});
    }
  }
  return failures.length?{ok:false,componentStatus:'FAILED',failures}:{ok:true,validated:step.params.expectations.map(e=>e.applicationStepId)};
}

export async function reconcilePosition(ctx,step) {
  const p=step.params,account=await componentAccount(ctx,p.accountStepId);
  const result=checkSnapshot({...step,params:{...p,tradingAccountId:String(account.trading_account_id)}},account,ctx.facts,ctx.progress);
  const position=ctx.facts.positions.find(r=>String(r.trading_account_id)===String(account.trading_account_id)
    &&r.fund_code===p.fundCode&&r.share_class===p.shareClass&&r.branch_code===account.branch_code);
  if(['availableVolume','frozenVolume'].some(name=>p[name]!==undefined&&units(p[name])!==units(position?.[name==='availableVolume'?'available_volume':'frozen_volume']??'0')))
    return {ok:false,componentStatus:'REVIEW',reason:'可用/冻结份额与预期不一致'};
  return result;
}
