import { stepProgress } from './plans.js';
import {componentRows,componentProgress} from './component-state.js';

export async function readFacts(context,token,ids) {
  const {db,keys,workflow,runtime}=context;
  const facts=await workflow.state(token,ids);
  delete facts.returnInbox;
  delete facts.messages;
  const [[stored]]=await db.execute('SELECT plan_json FROM agent_plans WHERE workspace_id=? AND chat_id=? AND run_id=? AND version=?',[...keys,runtime?.plan_version??0]);
  const [actions]=await db.execute('SELECT step_key,tool_name,action_key,status,result_json FROM agent_actions WHERE workspace_id=? AND chat_id=? AND run_id=? AND step_key IS NOT NULL ORDER BY id',keys);
  const [snapshots]=await db.execute('SELECT * FROM position_snapshots WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY snapshot_date DESC,id DESC LIMIT 200',keys);
  const [confirmationSources]=await db.execute(`SELECT c.confirmation_date,c.file_record_id,a.trading_account_id,a.fund_code,a.share_class,t.branch_code
    FROM confirmations c JOIN applications a ON a.workspace_id=c.workspace_id AND a.chat_id=c.chat_id AND a.run_id=c.run_id AND a.id=c.application_id
    JOIN trading_accounts t ON t.workspace_id=a.workspace_id AND t.chat_id=a.chat_id AND t.run_id=a.run_id AND t.id=a.trading_account_id
    WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.file_type='04' AND c.outcome='SUCCESS'
    ORDER BY c.confirmation_date DESC,c.id DESC LIMIT 101`,keys);
  facts.snapshots=snapshots;
  facts.confirmationSources=confirmationSources;
  const plan=stored?.plan_json??null;
  const components=plan?.schemaVersion===2?await componentRows(context):[];
  return {facts,plan,actions,components,progress:plan?.schemaVersion===2?componentProgress(plan,components):stepProgress(plan,actions,facts)};
}

export function modelFacts({facts,plan,progress},runtime,ids) {
  return {caseId:ids.chatPublicId,runId:ids.runPublicId,planVersion:runtime?.plan_version??0,
    memory:runtime?.memory_json??{notes:[]},wait:runtime?.wait_json??null,verdict:runtime?.verdict??'UNDETERMINED',
    businessDate:facts.scope.businessDate,plan,progress,
    executionVersion:runtime?.execution_version??null,
    counts:facts.counts,
    customers:facts.customers.map(c=>({id:c.id,name:c.investor_name,tradingAccountId:c.trading_account_id,
      accountStatus:c.account_status,hasTaAccount:!!c.ta_account_no})),
    funds:facts.funds.map(f=>({fundCode:f.fund_code,name:f.fund_name,shareClass:f.share_class})),
    positions:facts.positions.map(p=>({tradingAccountId:p.trading_account_id,fundCode:p.fund_code,
      shareClass:p.share_class,availableVolume:p.available_volume,totalVolume:p.total_volume})),
    confirmations:facts.confirmations.map(c=>({applicationId:c.application_id,fileType:c.file_type,
      businessCode:c.business_code,outcome:c.outcome,returnCode:c.return_code,errorDetail:c.error_detail,
      finishFlag:c.business_finish_flag,confirmedVolume:c.confirmed_volume,localNote:c.local_note})),
    packages:facts.packages.map(p=>({packageId:p.public_id,direction:p.direction,status:p.delivery_status,
      downloadUrl:p.direction==='OUTBOUND'?`/api/chats/${ids.chatPublicId}/runs/${ids.runPublicId}/packages/${p.public_id}/download`:undefined})),
    snapshots:facts.snapshots.map(s=>({id:s.id,date:s.snapshot_date,fundCode:s.fund_code,totalVolume:s.total_volume})),
    reconciliations:facts.reconciliations.map(r=>({snapshotId:r.snapshot_id,status:r.status,difference:r.difference})),
    truncated:facts.customerMore||facts.applicationMore||facts.confirmationMore};
}
