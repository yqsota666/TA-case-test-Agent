import crypto from 'node:crypto';
import {authenticateSession,assertWritableChat,mapDatabaseError} from '../platform/scope.js';
import {createChatInWorkspace} from '../platform/repository.js';
import {createWorkflowService,dateValue,decimalValue,fail} from '../platform/workflow-service.js';
import {planRound,summarizeCaseLoop,validateSop} from './sop.js';
import {evaluateSop} from './verdict.js';
import {encodeRecord} from '../../../../packages/platform-protocol/src/index.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>/^(workspace|owner|ledger|run|chat)/i.test(key)))
    fail('参数包含不允许的归属字段','SCOPE_OVERRIDE');
  return value;
};
const asJson=value=>typeof value==='string'?JSON.parse(value):value;
const ids=row=>({chatPublicId:row.ledger_chat_public_id,runPublicId:row.ledger_run_public_id});
const evidenceBasis=(sop,actions,confirmations,snapshots,assessment)=>{
  const needed=sop.actions.filter(a=>a.evidence05).map(a=>
    `${a.tradingAccountId}:${a.evidence05.fundCode}:${a.evidence05.shareClass}`);
  const relevant=snapshots.filter(s=>needed.includes(`${s.trading_account_id}:${s.fund_code}:${s.share_class}`));
  return crypto.createHash('sha256').update(JSON.stringify({version:sop.version,
    applications:actions.map(a=>String(a.id)),confirmations:confirmations.map(c=>String(c.id)),
    snapshots:relevant.map(s=>String(s.id)),assessment})).digest('hex');
};

export function createGlobalCaseService({transaction,archiveRoot,authenticate=authenticateSession,onReturns,onRetry}) {
  const workflow=createWorkflowService({transaction,archiveRoot,authenticate,onReturns});
  const scoped=async(token,fn)=>{
    try{return await transaction(async db=>fn(db,await authenticate(db,token)));}
    catch(error){throw mapDatabaseError(error);}
  };
  const caseRow=async(db,auth,casePublicId,lock=false)=>{
    if(!uuid.test(casePublicId??''))fail('Case 编号无效');
    const [[row]]=await db.execute(`SELECT g.*,c.public_id AS case_public_id,c.title,c.status AS chat_status,
      r.public_id AS run_public_id,r.status AS run_status,pc.public_id AS parent_chat_public_id
      FROM global_cases g JOIN test_chats c ON c.workspace_id=g.workspace_id AND c.id=g.chat_id
      JOIN test_runs r ON r.workspace_id=g.workspace_id AND r.chat_id=g.chat_id AND r.id=g.run_id
      JOIN test_chats pc ON pc.workspace_id=g.workspace_id AND pc.id=g.parent_chat_id
      WHERE g.workspace_id=? AND c.public_id=?${lock?' FOR UPDATE':''}`,[auth.workspace_id,casePublicId]);
    if(!row)fail('Case 不存在','CASE_NOT_FOUND',404);
    return row;
  };
  const ledgerRow=async(db,auth,chatPublicId,lock=false)=>{
    if(!uuid.test(chatPublicId??''))fail('Chat 编号无效');
    const [[row]]=await db.execute(`SELECT l.*,c.public_id AS ledger_chat_public_id,
      r.public_id AS ledger_run_public_id,DATE_FORMAT(r.business_date,'%Y-%m-%d') AS business_date
      FROM global_case_ledgers l JOIN test_chats c ON c.workspace_id=l.workspace_id AND c.id=l.chat_id
      JOIN test_runs r ON r.workspace_id=l.workspace_id AND r.chat_id=l.chat_id AND r.id=l.run_id
      WHERE l.workspace_id=? AND c.public_id=?${lock?' FOR UPDATE':''}`,[auth.workspace_id,chatPublicId]);
    return row;
  };
  const writableLedgerRow=async(db,auth,chatPublicId)=>{
    const ledger=await ledgerRow(db,auth,chatPublicId);
    if(!ledger)fail('Chat 不存在','CHAT_NOT_FOUND',404);
    await assertWritableChat(db,auth,ledger.chat_id);
    return ledgerRow(db,auth,chatPublicId,true);
  };
  const writableCaseRow=async(db,auth,casePublicId)=>{
    const row=await caseRow(db,auth,casePublicId);
    await assertWritableChat(db,auth,row.parent_chat_id);
    return caseRow(db,auth,casePublicId,true);
  };
  async function createChat(token,input){return scoped(token,async(db,auth)=>{
    const b=body(input),title=b.title?.trim(),businessDate=dateValue(b.businessDate);
    if(typeof title!=='string'||!title||title.length>160||!/^\d{1,20}$/.test(String(b.channelId)))fail('Chat 名称或通道无效');
    await db.execute('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[auth.workspace_id]);
    const [[open]]=await db.execute(`SELECT chat_id FROM global_case_ledgers
      WHERE workspace_id=? AND ended_at IS NULL ORDER BY chat_id LIMIT 1`,[auth.workspace_id]);
    if(open)fail('请先人工结束当前 Chat','CHAT_ALREADY_ACTIVE',409);
    const created=await createChatInWorkspace(db,auth,{title,channelId:b.channelId,businessDate});
    const [[run]]=await db.execute(`SELECT c.id AS chat_id,r.id AS run_id FROM test_chats c
      JOIN test_runs r ON r.workspace_id=c.workspace_id AND r.chat_id=c.id
      WHERE c.workspace_id=? AND c.public_id=? AND r.public_id=?`,[auth.workspace_id,created.chatPublicId,created.runPublicId]);
    await db.execute('INSERT INTO global_case_ledgers(workspace_id,channel_id,chat_id,run_id) VALUES (?,?,?,?)',
      [auth.workspace_id,b.channelId,run.chat_id,run.run_id]);
    return {...created,title,channelId:String(b.channelId)};
  });}
  async function listChats(token){return scoped(token,async(db,auth)=>{
    const [rows]=await db.execute(`SELECT c.public_id AS chatId,c.title,c.status,c.created_at AS createdAt,r.public_id AS runId,
      l.ended_at AS endedAt,l.ended_by AS endedBy,l.end_conclusion AS endConclusion,l.end_reason AS endReason,
      l.channel_id AS channelId,COUNT(g.chat_id) AS caseCount
      FROM global_case_ledgers l JOIN test_chats c ON c.workspace_id=l.workspace_id AND c.id=l.chat_id
      JOIN test_runs r ON r.workspace_id=l.workspace_id AND r.chat_id=l.chat_id AND r.id=l.run_id
      LEFT JOIN global_cases g ON g.workspace_id=l.workspace_id AND g.parent_chat_id=l.chat_id
      WHERE l.workspace_id=? GROUP BY c.public_id,c.title,c.status,c.created_at,r.public_id,l.channel_id,l.chat_id,
        l.ended_at,l.ended_by,l.end_conclusion,l.end_reason
      ORDER BY l.chat_id DESC LIMIT 500`,[auth.workspace_id]);
    return {chats:rows.map(r=>({...r,channelId:String(r.channelId),caseCount:Number(r.caseCount)}))};
  });}
  async function endChat(token,chatPublicId,input){return scoped(token,async(db,auth)=>{
    const b=body(input),reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!reason||reason.length>2000)fail('结束原因必填且不能超过 2000 字','CHAT_END_REASON_REQUIRED');
    const ledger=await writableLedgerRow(db,auth,chatPublicId);
    const [rows]=await db.execute(`SELECT c.public_id FROM global_cases g JOIN test_chats c
      ON c.workspace_id=g.workspace_id AND c.id=g.chat_id
      WHERE g.workspace_id=? AND g.parent_chat_id=? ORDER BY g.chat_id FOR UPDATE`,
    [auth.workspace_id,ledger.chat_id]);
    if(!rows.length)fail('空 Chat 不能结束','CHAT_EMPTY',409);
    const states=[];
    for(const {public_id:caseId} of rows)
      states.push({caseId,state:await caseStateInDb(db,auth,await caseRow(db,auth,caseId,true))});
    for(const {caseId,state} of states){
      if(state.retries.some(r=>r.targetSopVersion==null))
        fail(`Case ${caseId} 正等待重试 SOP`,'CHAT_RETRY_PENDING',409);
      if(state.assessment?.actions?.some(a=>['WAITING_RETURN','WAITING_05'].includes(a.status)))
        fail(`Case ${caseId} 尚有待回传事项`,'CHAT_RETURN_PENDING',409);
    }
    let failed=0;
    for(const {caseId,state} of states){
      if(!['PASS','FAIL'].includes(state.assessment?.verdict)||!state.humanDecision?.current)
        fail(`Case ${caseId} 尚未完成人工复核`,'CHAT_CASE_UNDECIDED',409);
      if(state.humanDecision.finalVerdict==='FAIL'){
        failed++;
        if(!state.humanDecision.reason?.trim())
          fail(`Case ${caseId} 的人工失败处置必须填写原因`,'FAIL_DISPOSITION_REQUIRED',409);
      }
    }
    const [[agentPending]]=await db.execute(`SELECT COUNT(*) AS n FROM agent_events e
      WHERE e.workspace_id=? AND e.status IN ('PENDING','PROCESSING') AND
        (e.chat_id=? OR e.chat_id IN (SELECT chat_id FROM global_cases WHERE workspace_id=? AND parent_chat_id=?))`,
    [auth.workspace_id,ledger.chat_id,auth.workspace_id,ledger.chat_id]);
    if(Number(agentPending.n))fail('Agent 仍有待处理讨论或 AI 判断','CHAT_AGENT_PENDING',409);
    const conclusion=failed?'ACCEPT_FAILURE':'ALL_PASS';
    await db.execute(`UPDATE global_case_ledgers SET ended_at=UTC_TIMESTAMP(3),ended_by=?,
      end_conclusion=?,end_reason=? WHERE workspace_id=? AND chat_id=? AND ended_at IS NULL`,
    [auth.user_id,conclusion,reason,auth.workspace_id,ledger.chat_id]);
    return {chatId:chatPublicId,ended:true,conclusion,reason,failedCaseCount:failed};
  });}
  const latestSop=async(db,row,lock=false)=>{
    const [[sop]]=await db.execute(`SELECT version,status,sop_json,created_at,approved_at FROM case_sop_versions
      WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY version DESC LIMIT 1${lock?' FOR UPDATE':''}`,
    [row.workspace_id,row.chat_id,row.run_id]);
    return sop?{...sop,sop_json:asJson(sop.sop_json)}:null;
  };

  async function createCase(token,chatPublicId,input){return scoped(token,async(db,auth)=>{
    const b=body(input),title=b.title?.trim();
    const ledger=await writableLedgerRow(db,auth,chatPublicId);
    const businessDate=dateValue(b.businessDate??ledger.business_date);
    if(typeof title!=='string'||!title||title.length>160)fail('Case 名称无效');
    if(b.channelId!=null&&String(b.channelId)!==String(ledger.channel_id))fail('Case 通道必须与 Chat 一致','CHANNEL_MISMATCH',409);
    const created=await createChatInWorkspace(db,auth,{title,channelId:ledger.channel_id,businessDate});
    const [[row]]=await db.execute(`SELECT c.id AS chat_id,r.id AS run_id FROM test_chats c
      JOIN test_runs r ON r.workspace_id=c.workspace_id AND r.chat_id=c.id
      WHERE c.workspace_id=? AND c.public_id=? AND r.public_id=?`,[auth.workspace_id,created.chatPublicId,created.runPublicId]);
    await db.execute('INSERT INTO global_cases(workspace_id,parent_chat_id,chat_id,run_id,channel_id) VALUES (?,?,?,?,?)',
      [auth.workspace_id,ledger.chat_id,row.chat_id,row.run_id,ledger.channel_id]);
    return {caseId:created.chatPublicId,chatId:chatPublicId,...created,channelId:String(ledger.channel_id)};
  });}

  async function listCases(token,chatPublicId){return scoped(token,async(db,auth)=>{
    const ledger=await ledgerRow(db,auth,chatPublicId);
    if(!ledger)fail('Chat 不存在','CHAT_NOT_FOUND',404);
    const [rows]=await db.execute(`SELECT c.public_id AS caseId,c.title,c.status AS caseStatus,c.created_at AS createdAt,
      r.public_id AS runId,g.channel_id AS channelId,s.version AS sopVersion,s.status AS sopStatus
      FROM global_cases g JOIN test_chats c ON c.workspace_id=g.workspace_id AND c.id=g.chat_id
      JOIN test_runs r ON r.workspace_id=g.workspace_id AND r.chat_id=g.chat_id AND r.id=g.run_id
      LEFT JOIN case_sop_versions s ON s.workspace_id=g.workspace_id AND s.chat_id=g.chat_id AND s.run_id=g.run_id
        AND s.version=(SELECT MAX(x.version) FROM case_sop_versions x WHERE x.workspace_id=g.workspace_id AND x.chat_id=g.chat_id AND x.run_id=g.run_id)
      WHERE g.workspace_id=? AND g.parent_chat_id=? ORDER BY g.chat_id DESC LIMIT 500`,[auth.workspace_id,ledger.chat_id]);
    return {chatId:chatPublicId,cases:rows.map(r=>({...r,channelId:String(r.channelId)}))};
  });}

  async function proposeSop(token,casePublicId,input){return scoped(token,async(db,auth)=>{
    const row=await writableCaseRow(db,auth,casePublicId),sop=validateSop(body(input));
    if(row.chat_status!=='ACTIVE'||!['DRAFT','ACTIVE'].includes(row.run_status))fail('Case 已封存','CASE_LOCKED',409);
    const [[started]]=await db.execute('SELECT COUNT(*) AS n FROM case_action_applications WHERE workspace_id=? AND case_chat_id=? AND case_run_id=?',
      [auth.workspace_id,row.chat_id,row.run_id]);
    const current=await latestSop(db,row,true),version=Number(current?.version??0)+1;
    let retry=null;
    if(Number(started.n)){
      const [[requested]]=await db.execute(`SELECT * FROM case_sop_retries WHERE workspace_id=? AND chat_id=? AND run_id=?
        AND (source_sop_version=? AND target_sop_version IS NULL OR target_sop_version=?)
        ORDER BY source_sop_version DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id,row.chat_id,row.run_id,current?.version,current?.version]);
      if(!requested)fail('已有申请的 SOP 不能改写；需先由人工发起重试','RETRY_REQUIRED',409);
      retry=requested;
    }
    if(current?.status==='PROPOSED')await db.execute(`UPDATE case_sop_versions SET status='SUPERSEDED'
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND version=?`,[auth.workspace_id,row.chat_id,row.run_id,current.version]);
    await db.execute(`INSERT INTO case_sop_versions(workspace_id,chat_id,run_id,version,status,sop_json,created_by)
      VALUES (?,?,?,?,'PROPOSED',?,?)`,[auth.workspace_id,row.chat_id,row.run_id,version,JSON.stringify(sop),auth.user_id]);
    if(retry)await db.execute(`UPDATE case_sop_retries SET target_sop_version=?
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND source_sop_version=?`,
    [version,auth.workspace_id,row.chat_id,row.run_id,retry.source_sop_version]);
    return {caseId:casePublicId,version,status:'PROPOSED',retryOfVersion:retry?.source_sop_version??null,sop};
  });}

  async function approveSop(token,casePublicId,version){return scoped(token,async(db,auth)=>{
    const row=await writableCaseRow(db,auth,casePublicId),current=await latestSop(db,row,true);
    if(!current||current.status!=='PROPOSED'||Number(version)!==Number(current.version))fail('SOP 提案版本已变化','SOP_CONFLICT',409);
    const sop=validateSop(current.sop_json,{approve:true}),ledger=await ledgerRow(db,auth,row.parent_chat_public_id);
    if(!ledger)fail('全局账本尚未建立','LEDGER_NOT_FOUND',409);
    const crossCaseIds=[...new Set(sop.actions.flatMap(a=>a.dependsOn??[]).map(d=>d.caseId).filter(Boolean))];
    if(crossCaseIds.length){
      const [owned]=await db.execute(`SELECT c.public_id FROM global_cases g JOIN test_chats c
        ON c.workspace_id=g.workspace_id AND c.id=g.chat_id
        WHERE g.workspace_id=? AND g.parent_chat_id=? AND c.public_id IN (${crossCaseIds.map(()=>'?').join(',')})`,
      [auth.workspace_id,row.parent_chat_id,...crossCaseIds]);
      if(owned.length!==crossCaseIds.length)fail('SOP 依赖的 Case 必须属于同一 Chat','CROSS_CHAT_DEPENDENCY',409);
    }
    const uniqueIds=[...new Set(sop.actions.map(a=>String(a.tradingAccountId)))];
    const [accounts]=await db.execute(`SELECT id FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=?
      AND id IN (${uniqueIds.map(()=>'?').join(',')})`,[auth.workspace_id,ledger.chat_id,ledger.run_id,...uniqueIds]);
    if(accounts.length!==uniqueIds.length)fail('SOP 引用了不存在的全局交易账户','SOP_DATA_MISSING',409);
    const funds=[...new Set(sop.actions.filter(a=>a.fileType==='03'&&a.fields?.FundCode)
      .map(a=>`${a.fields.FundCode}:${a.fields.ShareClass??'0'}`))];
    for(const fund of funds){
      const [code,shareClass]=fund.split(':');
      const [[known]]=await db.execute('SELECT id FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',
        [auth.workspace_id,ledger.chat_id,ledger.run_id,code,shareClass]);
      if(!known)fail(`基金 ${fund} 尚未在数据平台配置`,'SOP_DATA_MISSING',409);
    }
    await db.execute(`UPDATE case_sop_versions SET status='APPROVED',approved_by=?,approved_at=UTC_TIMESTAMP(3)
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND version=?`,[auth.user_id,auth.workspace_id,row.chat_id,row.run_id,version]);
    return {caseId:casePublicId,version:Number(version),status:'APPROVED'};
  });}

  const caseStateInDb=async(db,auth,row)=>{
    const sop=await latestSop(db,row);
    const [actions]=await db.execute(`SELECT l.sop_version,l.action_key,a.id,a.app_no,a.file_type,a.business_code,a.status,
      a.business_date,a.created_at,b.public_id AS batch_id,b.created_at AS batch_created_at,
      (SELECT c.outcome FROM confirmations c WHERE c.workspace_id=a.workspace_id AND c.chat_id=a.chat_id
        AND c.run_id=a.run_id AND c.application_id=a.id ORDER BY c.id DESC LIMIT 1) AS outcome
      FROM case_action_applications l JOIN applications a ON a.workspace_id=l.workspace_id
        AND a.chat_id=l.ledger_chat_id AND a.run_id=l.ledger_run_id AND a.id=l.application_id
      JOIN global_case_batches b ON b.id=l.batch_id
      WHERE l.workspace_id=? AND l.case_chat_id=? AND l.case_run_id=? ORDER BY b.iteration,a.id`,
    [auth.workspace_id,row.chat_id,row.run_id]);
    let assessment=null,basisHash=null,availableEvidence={confirmationIds:[],snapshotIds:[]};
    if(sop?.status==='APPROVED'){
      const ledger=await ledgerRow(db,auth,row.parent_chat_public_id);
      const [confirmations]=await db.execute(`SELECT c.id,c.application_id,c.outcome,c.return_code,c.confirmation_date,
        c.business_finish_flag,c.record_json,f.match_status,f.match_reason
        FROM confirmations c JOIN file_records f ON f.workspace_id=c.workspace_id AND f.chat_id=c.chat_id
          AND f.run_id=c.run_id AND f.id=c.file_record_id
        WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.application_id IN
          (SELECT application_id FROM case_action_applications WHERE workspace_id=? AND case_chat_id=? AND case_run_id=? AND sop_version=?)
        ORDER BY c.id`,[auth.workspace_id,ledger.chat_id,ledger.run_id,auth.workspace_id,row.chat_id,row.run_id,sop.version]);
      const [snapshots]=await db.execute(`SELECT id,trading_account_id,fund_code,share_class,snapshot_date,total_volume
        FROM position_snapshots WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id DESC`,
      [auth.workspace_id,ledger.chat_id,ledger.run_id]);
      const currentActions=actions.filter(a=>Number(a.sop_version)===Number(sop.version));
      assessment=evaluateSop(sop.sop_json,currentActions,confirmations,snapshots);
      basisHash=evidenceBasis({version:Number(sop.version),actions:sop.sop_json.actions},currentActions,confirmations,snapshots,assessment);
      const needed=sop.sop_json.actions.filter(a=>a.evidence05).map(a=>
        `${a.tradingAccountId}:${a.evidence05.fundCode}:${a.evidence05.shareClass}`);
      availableEvidence={confirmationIds:confirmations.map(c=>String(c.id)),
        snapshotIds:snapshots.filter(s=>needed.includes(`${s.trading_account_id}:${s.fund_code}:${s.share_class}`))
          .map(s=>String(s.id))};
    }
    const [[decision]]=await db.execute(`SELECT revision,sop_version,basis_hash,suggested_verdict,suggested_json,
      final_verdict,reason,evidence_json,decided_by,decided_at FROM case_human_verdicts
      WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY revision DESC LIMIT 1`,
    [auth.workspace_id,row.chat_id,row.run_id]);
    const [retryRows]=await db.execute(`SELECT retry.source_sop_version,retry.target_sop_version,
      retry.ai_assessment_json,retry.human_decision_json,retry.human_reason,retry.requested_by,retry.requested_at,
      source.sop_json AS source_sop_json FROM case_sop_retries retry JOIN case_sop_versions source
        ON source.workspace_id=retry.workspace_id AND source.chat_id=retry.chat_id AND source.run_id=retry.run_id
        AND source.version=retry.source_sop_version
      WHERE retry.workspace_id=? AND retry.chat_id=? AND retry.run_id=? ORDER BY retry.source_sop_version`,
    [auth.workspace_id,row.chat_id,row.run_id]);
    const retries=retryRows.map(r=>({sourceSopVersion:Number(r.source_sop_version),
      targetSopVersion:r.target_sop_version==null?null:Number(r.target_sop_version),
      sourceSop:asJson(r.source_sop_json),aiAssessment:asJson(r.ai_assessment_json),
      humanDecision:r.human_decision_json==null?null:asJson(r.human_decision_json),
      humanReason:r.human_reason,requestedBy:String(r.requested_by),requestedAt:r.requested_at}));
    return {case:{caseId:row.case_public_id,chatId:row.parent_chat_public_id,title:row.title,runId:row.run_public_id,channelId:String(row.channel_id)},
      sop:sop?{version:sop.version,status:sop.status,value:sop.sop_json,createdAt:sop.created_at,approvedAt:sop.approved_at}:null,actions,assessment,retries,
      availableEvidence,humanDecision:decision?{revision:decision.revision,sopVersion:decision.sop_version,
        suggestedVerdict:decision.suggested_verdict,suggested:asJson(decision.suggested_json),
        finalVerdict:decision.final_verdict,reason:decision.reason,evidence:asJson(decision.evidence_json),
        decidedBy:String(decision.decided_by),decidedAt:decision.decided_at,
        current:decision.basis_hash===basisHash&&Number(decision.sop_version)===Number(sop?.version)}:null,
      basisHash};
  };
  async function caseState(token,casePublicId){return scoped(token,async(db,auth)=>
    caseStateInDb(db,auth,await caseRow(db,auth,casePublicId)));}

  async function requestRetry(token,casePublicId,input){return scoped(token,async(db,auth)=>{
    const b=body(input),reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!reason||reason.length>2000)fail('人工重试原因必填且不能超过 2000 字','RETRY_REASON_REQUIRED');
    const row=await writableCaseRow(db,auth,casePublicId),state=await caseStateInDb(db,auth,row);
    if(row.chat_status!=='ACTIVE'||!['DRAFT','ACTIVE'].includes(row.run_status))
      fail('Case 已封存','CASE_LOCKED',409);
    if(state.sop?.status!=='APPROVED'||!['FAIL','REVIEW'].includes(state.assessment?.verdict))
      fail('只有 AI 判为 FAIL 或 REVIEW 的已执行 SOP 可以重试','RETRY_NOT_ALLOWED',409);
    if(state.assessment.actions.some(a=>['WAITING_RETURN','WAITING_05'].includes(a.status)))
      fail('仍有已发申请等待 TA 回传或 05，不能启动重试','RETRY_RETURN_PENDING',409);
    if(state.humanDecision?.current&&state.humanDecision.finalVerdict==='PASS')
      fail('人工已确认通过，不能重试','CASE_ALREADY_PASSED',409);
    const version=Number(state.sop.version);
    const [[prior]]=await db.execute(`SELECT source_sop_version FROM case_sop_retries
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND source_sop_version=?`,
    [auth.workspace_id,row.chat_id,row.run_id,version]);
    if(prior)fail('本轮已发起重试','RETRY_ALREADY_REQUESTED',409);
    await db.execute(`INSERT INTO case_sop_retries
      (workspace_id,chat_id,run_id,source_sop_version,ai_assessment_json,human_decision_json,human_reason,requested_by)
      VALUES (?,?,?,?,?,?,?,?)`,[auth.workspace_id,row.chat_id,row.run_id,version,
        JSON.stringify(state.assessment),state.humanDecision?JSON.stringify(state.humanDecision):null,reason,auth.user_id]);
    if(onRetry)await onRetry({db,auth,scope:{workspace_id:auth.workspace_id,chat_id:row.chat_id,run_id:row.run_id},
      version,reason});
    return {caseId:casePublicId,sourceSopVersion:version,status:'RETRY_SOP_REQUIRED',humanReason:reason};
  });}

  async function confirmCaseVerdict(token,casePublicId,input){return scoped(token,async(db,auth)=>{
    const b=body(input),row=await writableCaseRow(db,auth,casePublicId);
    const state=await caseStateInDb(db,auth,row);
    if(!['PASS','FAIL'].includes(state.assessment?.verdict))
      fail('Case 证据尚不足，不能确认最终结论','CASE_NOT_DECIDABLE',409);
    if(!['PASS','FAIL'].includes(b.verdict))fail('人工结论只允许 PASS 或 FAIL','INVALID_VERDICT');
    const reason=typeof b.reason==='string'?b.reason.trim():'';
    if(reason.length>2000)fail('修改理由过长','INVALID_REASON');
    const evidence=b.evidence??{confirmationIds:[],snapshotIds:[]};
    if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)
      ||Object.keys(evidence).some(k=>!['confirmationIds','snapshotIds'].includes(k)))
      fail('证据引用格式无效','INVALID_EVIDENCE');
    const refs={};
    for(const key of ['confirmationIds','snapshotIds']){
      const values=evidence[key]??[];
      if(!Array.isArray(values)||values.length>100||values.some(v=>!/^\d{1,20}$/.test(String(v)))
        ||new Set(values.map(String)).size!==values.length
        ||values.some(v=>!state.availableEvidence[key].includes(String(v))))
        fail('证据引用不属于当前 Case','INVALID_EVIDENCE');
      refs[key]=values.map(String);
    }
    if(b.verdict!==state.assessment.verdict&&(!reason||!refs.confirmationIds.length&&!refs.snapshotIds.length))
      fail('修改建议结论时必须填写理由并引用本 Case 证据','OVERRIDE_REASON_REQUIRED',409);
    const revision=Number(state.humanDecision?.revision??0)+1;
    await db.execute(`INSERT INTO case_human_verdicts
      (workspace_id,chat_id,run_id,revision,sop_version,basis_hash,suggested_verdict,suggested_json,
       final_verdict,reason,evidence_json,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [auth.workspace_id,row.chat_id,row.run_id,revision,Number(state.sop.version),state.basisHash,
        state.assessment.verdict,JSON.stringify(state.assessment),b.verdict,reason,JSON.stringify(refs),auth.user_id]);
    return {caseId:casePublicId,revision,suggestedVerdict:state.assessment.verdict,
      finalVerdict:b.verdict,reason,evidence:refs,current:true};
  });}

  async function data(token,chatPublicId){
    const ledger=await scoped(token,(db,auth)=>ledgerRow(db,auth,chatPublicId));
    if(!ledger)fail('数据平台尚未初始化','LEDGER_NOT_FOUND',404);
    return workflow.state(token,ids(ledger));
  }
  async function listData(token,chatPublicId,kind,{after='0',limit='100',search=''}={}){return scoped(token,async(db,auth)=>{
    if(!uuid.test(chatPublicId??'')||!/^\d{1,20}$/.test(String(after))
      ||!/^\d{1,3}$/.test(String(limit))||Number(limit)<1||Number(limit)>100
      ||typeof search!=='string'||search.length>100)fail('数据分页参数无效');
    const ledger=await ledgerRow(db,auth,chatPublicId);
    if(!ledger)fail('数据平台尚未初始化','LEDGER_NOT_FOUND',404);
    const table={customers:'test_customers',accounts:'trading_accounts',funds:'run_funds',targets:'target_positions'}[kind];
    if(!table)fail('数据类型不支持');
    const key=[auth.workspace_id,ledger.chat_id,ledger.run_id,after];
    const filter=kind==='customers'?' AND (investor_name LIKE ? OR certificate_no LIKE ?)':
      kind==='accounts'?' AND transaction_account_no LIKE ?':kind==='funds'?' AND (fund_name LIKE ? OR fund_code LIKE ?)':
        ' AND fund_code LIKE ?';
    const pattern=`%${search}%`,patterns=kind==='customers'||kind==='funds'?[pattern,pattern]:[pattern];
    const [rows]=await db.execute(`SELECT * FROM ${table} WHERE workspace_id=? AND chat_id=? AND run_id=? AND id>?${filter}
      ORDER BY id LIMIT ${Number(limit)+1}`,[...key,...patterns]);
    const more=rows.length>Number(limit),items=rows.slice(0,Number(limit));
    return {items,more,nextAfter:items.length?String(items.at(-1).id):String(after)};
  });}
  async function createData(token,chatPublicId,kind,input){
    const ledger=await scoped(token,(db,auth)=>ledgerRow(db,auth,chatPublicId));
    if(!ledger)fail('数据平台尚未初始化','LEDGER_NOT_FOUND',404);
    if(kind==='accounts'){
      const b=body(input);
      if(!uuid.test(b.customerPublicId??''))fail('客户编号无效');
      return workflow.defineAccount(token,ids(ledger),b.customerPublicId,{branchCode:b.branchCode,transactionAccountNo:b.transactionAccountNo});
    }
    const methods={customers:'addCustomers',funds:'addFund',targets:'addTarget'};
    if(!methods[kind])fail('数据类型不支持');
    return workflow[methods[kind]](token,ids(ledger),body(input));
  }
  const mutableLedger=async(db,auth,chatPublicId)=>{
    if(!uuid.test(chatPublicId??''))fail('Chat 编号无效');
    const ledger=await writableLedgerRow(db,auth,chatPublicId);
    const [[channel]]=await db.execute('SELECT ta_environment_id FROM exchange_channels WHERE workspace_id=? AND id=?',
      [auth.workspace_id,ledger.channel_id]);
    await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[channel.ta_environment_id]);
    return ledger;
  };
  const record=async(db,auth,ledger,table,id)=>{
    if(!/^\d{1,20}$/.test(String(id)))fail('记录编号无效');
    const [[row]]=await db.execute(`SELECT * FROM ${table} WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=? FOR UPDATE`,
      [auth.workspace_id,ledger.chat_id,ledger.run_id,id]);
    if(!row)fail('全局数据记录不存在','RECORD_NOT_FOUND',404);
    return row;
  };
  const assertUnused=async(db,auth,ledger,{accountId,fundCode,shareClass}={})=>{
    const [cases]=await db.execute(`SELECT s.sop_json FROM case_sop_versions s JOIN global_cases g
      ON g.workspace_id=s.workspace_id AND g.chat_id=s.chat_id AND g.run_id=s.run_id
      WHERE g.workspace_id=? AND g.parent_chat_id=? AND s.status='APPROVED'`,[auth.workspace_id,ledger.chat_id]);
    if(cases.some(({sop_json})=>asJson(sop_json).actions.some(a=>
      accountId!=null&&String(a.tradingAccountId)===String(accountId)
      ||fundCode!=null&&a.fields?.FundCode===fundCode&&(a.fields?.ShareClass??'0')===shareClass)))
      fail('数据已被确认的 SOP 引用，不能修改或删除','DATA_IN_APPROVED_SOP',409);
  };
  async function updateData(token,chatPublicId,kind,id,input){return scoped(token,async(db,auth)=>{
    const b=body(input),ledger=await mutableLedger(db,auth,chatPublicId),keys=[auth.workspace_id,ledger.chat_id,ledger.run_id];
    if(kind==='customers'){
      const current=await record(db,auth,ledger,'test_customers',id);
      const [accounts]=await db.execute('SELECT id FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND customer_id=?',
        [...keys,id]);
      for(const account of accounts)await assertUnused(db,auth,ledger,{accountId:account.id});
      if(Object.keys(b).some(k=>!['investorName','investorType','simulatedBalance','profile','mobile','email','address'].includes(k)))fail('客户字段不可修改');
      const name=b.investorName??current.investor_name,type=b.investorType??current.investor_type;
      if(typeof name!=='string'||!name.trim()||name.length>180||!['0','1'].includes(type))fail('客户资料无效');
      const profile=b.profile??asJson(current.profile_json);
      if(!profile||typeof profile!=='object'||Array.isArray(profile))fail('客户协议资料无效');
      try{encodeRecord('01',{...profile,InvestorName:name},'22');}
      catch(error){fail(`客户协议资料无效：${error.message}`,'INVALID_PROTOCOL_FIELD');}
      const balance=decimalValue(b.simulatedBalance??String(current.simulated_balance));
      await db.execute(`UPDATE test_customers SET investor_name=?,investor_type=?,simulated_balance=?,profile_json=?,mobile=?,email=?,address=?
        WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?`,[name.trim(),type,balance,JSON.stringify(profile),
        b.mobile??current.mobile,b.email??current.email,b.address??current.address,...keys,id]);
    }else if(kind==='accounts'){
      const current=await record(db,auth,ledger,'trading_accounts',id);
      await assertUnused(db,auth,ledger,{accountId:id});
      if(Object.keys(b).some(k=>k!=='branchCode')||typeof b.branchCode!=='string'||!/^[A-Za-z0-9]{1,9}$/.test(b.branchCode))fail('只允许修改账户网点；TA 状态由回传决定');
      await db.execute('UPDATE trading_accounts SET branch_code=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',
        [b.branchCode,...keys,current.id]);
    }else if(kind==='funds'){
      const current=await record(db,auth,ledger,'run_funds',id);
      await assertUnused(db,auth,ledger,{fundCode:current.fund_code,shareClass:current.share_class});
      if(Object.keys(b).some(k=>!['fundName','nav'].includes(k)))fail('基金字段不可修改');
      const name=b.fundName??current.fund_name;
      if(typeof name!=='string'||!name.trim()||name.length>200)fail('基金名称无效');
      const nav=b.nav==null?current.nav:decimalValue(b.nav,8);
      await db.execute('UPDATE run_funds SET fund_name=?,nav=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',
        [name.trim(),nav,...keys,id]);
    }else if(kind==='targets'){
      await record(db,auth,ledger,'target_positions',id);
      if(Object.keys(b).some(k=>k!=='targetVolume')||b.targetVolume==null)fail('目标份额字段无效');
      await db.execute('UPDATE target_positions SET target_volume=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',
        [decimalValue(b.targetVolume),...keys,id]);
    }else fail('数据类型不支持');
    return {ok:true,id:String(id)};
  });}
  async function deleteData(token,chatPublicId,kind,id){return scoped(token,async(db,auth)=>{
    const ledger=await mutableLedger(db,auth,chatPublicId),keys=[auth.workspace_id,ledger.chat_id,ledger.run_id];
    if(kind==='customers'){
      const current=await record(db,auth,ledger,'test_customers',id);
      const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND customer_id=?',
        [...keys,id]);
      if(Number(count.n))fail('请先删除客户的交易账户','DATA_IN_USE',409);
      await db.execute('DELETE FROM test_customers WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...keys,id]);
      await db.execute(`DELETE FROM test_identifiers WHERE workspace_id=? AND chat_id=? AND run_id=?
        AND identifier_kind='CERTIFICATE' AND namespace=? AND identifier_value=?`,
        [...keys,current.certificate_type,current.certificate_no]);
    }else if(kind==='accounts'){
      const current=await record(db,auth,ledger,'trading_accounts',id);
      await assertUnused(db,auth,ledger,{accountId:id});
      const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=?',
        [...keys,id]);
      if(Number(count.n))fail('账户已有申请，不能删除','DATA_IN_USE',409);
      await db.execute('DELETE FROM target_positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=?',[...keys,id]);
      await db.execute('DELETE FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...keys,id]);
      await db.execute(`DELETE FROM test_identifiers WHERE workspace_id=? AND chat_id=? AND run_id=?
        AND identifier_kind='TRANSACTION' AND namespace=? AND identifier_value=?`,
        [...keys,current.distributor_code,current.transaction_account_no]);
    }else if(kind==='funds'){
      const current=await record(db,auth,ledger,'run_funds',id);
      await assertUnused(db,auth,ledger,{fundCode:current.fund_code,shareClass:current.share_class});
      const [[count]]=await db.execute('SELECT COUNT(*) AS n FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',
        [...keys,current.fund_code,current.share_class]);
      if(Number(count.n))fail('基金已有申请，不能删除','DATA_IN_USE',409);
      await db.execute('DELETE FROM target_positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',
        [...keys,current.fund_code,current.share_class]);
      await db.execute('DELETE FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...keys,id]);
    }else if(kind==='targets'){
      await record(db,auth,ledger,'target_positions',id);
      await db.execute('DELETE FROM target_positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[...keys,id]);
    }else fail('数据类型不支持');
    return {ok:true,id:String(id)};
  });}

  const activeCases=async(db,auth,parentChatId)=>{
    const [rows]=await db.execute(`SELECT g.*,c.public_id AS case_public_id,c.status AS chat_status,r.status AS run_status,
      s.version,s.status AS sop_status,s.sop_json,
      EXISTS(SELECT 1 FROM case_sop_retries retry WHERE retry.workspace_id=g.workspace_id
        AND retry.chat_id=g.chat_id AND retry.run_id=g.run_id AND retry.source_sop_version=s.version
        AND retry.target_sop_version IS NULL) AS retry_requested
      FROM global_cases g JOIN test_chats c ON c.workspace_id=g.workspace_id AND c.id=g.chat_id
      JOIN test_runs r ON r.workspace_id=g.workspace_id AND r.chat_id=g.chat_id AND r.id=g.run_id
      LEFT JOIN case_sop_versions s ON s.workspace_id=g.workspace_id AND s.chat_id=g.chat_id AND s.run_id=g.run_id
        AND s.version=(SELECT MAX(x.version) FROM case_sop_versions x WHERE x.workspace_id=g.workspace_id AND x.chat_id=g.chat_id AND x.run_id=g.run_id)
      WHERE g.workspace_id=? AND g.parent_chat_id=? AND c.status='ACTIVE' ORDER BY g.chat_id`,[auth.workspace_id,parentChatId]);
    return rows;
  };
  const channelPlan=async(db,auth,channelId,selected,ledger)=>{
    const [accounts]=await db.execute('SELECT id,status FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=?',
      [auth.workspace_id,ledger.chat_id,ledger.run_id]);
    const [linked]=await db.execute(`SELECT c.public_id AS caseId,l.action_key AS actionId,l.sop_version,
      a.id,a.app_no,a.status,a.business_date,
      (SELECT cf.outcome FROM confirmations cf WHERE cf.workspace_id=a.workspace_id AND cf.chat_id=a.chat_id
        AND cf.run_id=a.run_id AND cf.application_id=a.id ORDER BY cf.id DESC LIMIT 1) AS outcome
      FROM case_action_applications l JOIN test_chats c ON c.workspace_id=l.workspace_id AND c.id=l.case_chat_id
      JOIN applications a ON a.workspace_id=l.workspace_id AND a.chat_id=l.ledger_chat_id
        AND a.run_id=l.ledger_run_id AND a.id=l.application_id
      WHERE l.workspace_id=? AND l.ledger_chat_id=? AND l.ledger_run_id=?`,
      [auth.workspace_id,ledger.chat_id,ledger.run_id]);
    const [confirmations]=await db.execute(`SELECT cf.id,cf.application_id,cf.outcome,cf.return_code,cf.confirmation_date,
      cf.business_finish_flag,cf.record_json,f.match_status,f.match_reason FROM confirmations cf
      JOIN file_records f ON f.workspace_id=cf.workspace_id AND f.chat_id=cf.chat_id AND f.run_id=cf.run_id AND f.id=cf.file_record_id
      WHERE cf.workspace_id=? AND cf.chat_id=? AND cf.run_id=?`,[auth.workspace_id,ledger.chat_id,ledger.run_id]);
    const [snapshots]=await db.execute(`SELECT id,trading_account_id,fund_code,share_class,snapshot_date,total_volume
      FROM position_snapshots WHERE workspace_id=? AND chat_id=? AND run_id=?`,[auth.workspace_id,ledger.chat_id,ledger.run_id]);
    const cases=selected.map(r=>{
      const sop=asJson(r.sop_json),applications=linked.filter(a=>a.caseId===r.case_public_id&&Number(a.sop_version)===Number(r.version))
        .map(a=>({...a,action_key:a.actionId}));
      return {caseId:r.case_public_id,version:Number(r.version),status:r.sop_status,sop,
        assessment:evaluateSop(sop,applications,confirmations,snapshots)};
    });
    const byAction=new Map(cases.flatMap(c=>c.assessment.actions.map(a=>[`${c.caseId}:${a.actionId}`,a.status])));
    const currentVersions=new Map(cases.map(c=>[c.caseId,c.version]));
    const verified=linked.filter(a=>Number(a.sop_version)===currentVersions.get(a.caseId))
      .map(a=>({...a,verificationStatus:byAction.get(`${a.caseId}:${a.actionId}`)??null}));
    const round=planRound(cases,verified,accounts);
    return {cases,round,summary:summarizeCaseLoop(cases,round)};
  };
  async function progress(token,chatPublicId){return scoped(token,async(db,auth)=>{
    const ledger=await ledgerRow(db,auth,chatPublicId);
    if(!ledger)fail('Chat 不存在','CHAT_NOT_FOUND',404);
    const rows=await activeCases(db,auth,ledger.chat_id);
    if(!rows.length)return {chatId:chatPublicId,phase:'NO_CASES',allDecided:false,allPassed:false,cases:[],channels:[]};
    const unfinished=rows.filter(r=>r.sop_status!=='APPROVED'||Number(r.retry_requested)!==0);
    if(unfinished.length)return {chatId:chatPublicId,phase:'SOP_REQUIRED',allDecided:false,allPassed:false,
      cases:rows.map(r=>({caseId:r.case_public_id,sopStatus:Number(r.retry_requested)!==0?'RETRY_SOP_REQUIRED':r.sop_status??'MISSING'})),channels:[]};
    const channelId=String(ledger.channel_id);
    const {summary}=await channelPlan(db,auth,channelId,rows,ledger);
    const channels=[{channelId,...summary}];
    const humanStates=[];
    for(const row of rows)humanStates.push(await caseStateInDb(db,auth,
      await caseRow(db,auth,row.case_public_id)));
    const finalByCase=new Map(humanStates.map(s=>[s.case.caseId,s.humanDecision?.current
      ?s.humanDecision.finalVerdict:null]));
    for(const channel of channels){
      const suggestedPhase=channel.phase;
      channel.cases=channel.cases.map(c=>({...c,finalVerdict:finalByCase.get(c.caseId)}));
      const confirmed=channel.cases.every(c=>c.finalVerdict);
      channel.phase=confirmed?(channel.cases.every(c=>c.finalVerdict==='PASS')?'ALL_PASS':'COMPLETE_WITH_FAILURE'):
        channel.allDecided?'AWAITING_HUMAN_VERDICT':suggestedPhase;
      channel.suggestedPhase=suggestedPhase;
      channel.allDecided=confirmed;
      channel.allPassed=confirmed&&channel.cases.every(c=>c.finalVerdict==='PASS');
    }
    const allDecided=humanStates.every(s=>s.humanDecision?.current);
    const allPassed=allDecided&&humanStates.every(s=>s.humanDecision.finalVerdict==='PASS');
    const suggestionsReady=channels.every(c=>c.suggestedPhase==='ALL_PASS'||c.suggestedPhase==='COMPLETE_WITH_FAILURE');
    const phase=allDecided?(allPassed?'ALL_PASS':'COMPLETE_WITH_FAILURE'):
      channels.some(c=>c.phase==='READY_TO_GENERATE')?'READY_TO_GENERATE':
        channels.some(c=>c.phase==='REVIEW_REQUIRED')?'REVIEW_REQUIRED':
          channels.some(c=>c.phase==='BLOCKED_DEPENDENCY')?'BLOCKED_DEPENDENCY':
            suggestionsReady?'AWAITING_HUMAN_VERDICT':'WAITING_FOR_RETURN';
    return {chatId:chatPublicId,phase,allDecided,allPassed,cases:channels.flatMap(c=>c.cases),channels};
  });}
  async function generateRound(token,chatPublicId){return scoped(token,async(db,auth)=>{
    const ledger=await writableLedgerRow(db,auth,chatPublicId);
    await db.execute('SELECT chat_id FROM global_cases WHERE workspace_id=? AND parent_chat_id=? ORDER BY chat_id FOR UPDATE',
      [auth.workspace_id,ledger.chat_id]);
    const rows=await activeCases(db,auth,ledger.chat_id);
    if(!rows.length)fail('尚无 Case，不能生成文件','NO_CASES',409);
    const unfinished=rows.filter(r=>r.sop_status!=='APPROVED'||Number(r.retry_requested)!==0);
    if(unfinished.length)fail(`所有 Case 必须先确认 SOP；尚未完成：${unfinished.map(r=>r.case_public_id).join('、')}`,'SOP_NOT_APPROVED',409);
    const channelIds=[String(ledger.channel_id)];
    const [channels]=await db.execute(`SELECT id,ta_environment_id FROM exchange_channels WHERE workspace_id=?
      AND id IN (${channelIds.map(()=>'?').join(',')})`,[auth.workspace_id,...channelIds]);
    for(const env of [...new Set(channels.map(r=>String(r.ta_environment_id)))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1))
      await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[env]);
    const nested=createWorkflowService({transaction:fn=>fn(db),archiveRoot,authenticate});
    const batches=[],summaries=[];
    for(const channelId of channelIds){
      const selected=rows;
      const {cases,round,summary}=await channelPlan(db,auth,channelId,selected,ledger);
      summaries.push(summary);
      if(!round.ready.length)continue;
      const [[counter]]=await db.execute('SELECT COALESCE(MAX(iteration),0)+1 AS next_iteration FROM global_case_batches WHERE workspace_id=? AND ledger_chat_id=?',
        [auth.workspace_id,ledger.chat_id]);
      const batchPublicId=crypto.randomUUID(),iteration=Number(counter.next_iteration);
      const [inserted]=await db.execute(`INSERT INTO global_case_batches
        (public_id,workspace_id,channel_id,ledger_chat_id,ledger_run_id,iteration,created_by)
        VALUES (?,?,?,?,?,?,?)`,[batchPublicId,auth.workspace_id,channelId,ledger.chat_id,ledger.run_id,iteration,auth.user_id]);
      const byCase=new Map(selected.map(r=>[r.case_public_id,r]));
      const byDate=new Map();
      for(const item of round.ready){
        const a=item.action,source=byCase.get(item.caseId);
        const created=await nested.createApplication(token,ids(ledger),{
          tradingAccountId:String(a.tradingAccountId),fileType:a.fileType,businessCode:a.businessCode,businessDate:a.businessDate,
          testMode:a.testMode??'NORMAL',...(a.applicationAmount?{applicationAmount:a.applicationAmount}:{}),
          ...(a.applicationVolume?{applicationVolume:a.applicationVolume}:{}),fields:a.fields??{},
          expectedResult:{caseId:item.caseId,sopVersion:item.version,actionId:a.id},
        });
        await db.execute(`INSERT INTO case_action_applications
          (workspace_id,case_chat_id,case_run_id,sop_version,action_key,ledger_chat_id,ledger_run_id,application_id,batch_id)
          VALUES (?,?,?,?,?,?,?,?,?)`,[auth.workspace_id,source.chat_id,source.run_id,item.version,a.id,
          ledger.chat_id,ledger.run_id,created.id,inserted.insertId]);
        if(!byDate.has(a.businessDate))byDate.set(a.businessDate,[]);
        byDate.get(a.businessDate).push(created.id);
      }
      const packages=[];
      for(const applicationIds of byDate.values()){
        const generated=await nested.generate(token,ids(ledger),{applicationIds});
        const [[p]]=await db.execute('SELECT id FROM exchange_packages WHERE workspace_id=? AND channel_id=? AND public_id=?',
          [auth.workspace_id,channelId,generated.publicId]);
        await db.execute('INSERT INTO global_batch_packages(workspace_id,channel_id,batch_id,package_id) VALUES (?,?,?,?)',
          [auth.workspace_id,channelId,inserted.insertId,p.id]);
        packages.push({...generated,downloadUrl:`/api/v2/batches/${batchPublicId}/packages/${generated.publicId}/download`});
      }
      await db.execute("UPDATE global_case_batches SET status='GENERATED' WHERE id=?",[inserted.insertId]);
      batches.push({batchId:batchPublicId,channelId,iteration,caseCount:cases.length,
        actionCount:round.ready.length,maxPlannedRounds:round.maxPlannedRounds,
        waiting:round.waiting.map(item=>({caseId:item.caseId,actionId:item.action.id,reason:item.reason})),packages});
    }
    if(!batches.length&&summaries.every(s=>s.allDecided)){
      let allConfirmed=true;
      for(const row of rows){
        const state=await caseStateInDb(db,auth,await caseRow(db,auth,row.case_public_id));
        if(!state.humanDecision?.current)allConfirmed=false;
      }
      if(allConfirmed)fail('所有 Case 已有人工作出的最终结论','ALL_CASES_COMPLETE',409);
      fail('所有 Case 已有建议结论；请逐 Case 人工确认','HUMAN_VERDICT_PENDING',409);
    }
    if(!batches.length)fail('当前没有可发申请；请等待或补传 TA 回传，或处理待核对证据','NO_READY_ACTIONS',409);
    return {chatId:chatPublicId,batches};
  });}

  async function batchPackage(token,batchPublicId,packagePublicId){return scoped(token,async(db,auth)=>{
    if(!uuid.test(batchPublicId??'')||!uuid.test(packagePublicId??''))fail('批次或文件包编号无效');
    const [[row]]=await db.execute(`SELECT l.chat_id,l.run_id,c.public_id AS ledger_chat_public_id,
      r.public_id AS ledger_run_public_id FROM global_case_batches b
      JOIN global_batch_packages link ON link.batch_id=b.id
      JOIN exchange_packages p ON p.workspace_id=link.workspace_id AND p.channel_id=link.channel_id AND p.id=link.package_id
      JOIN global_case_ledgers l ON l.workspace_id=b.workspace_id AND l.chat_id=b.ledger_chat_id
      JOIN test_chats c ON c.workspace_id=l.workspace_id AND c.id=l.chat_id
      JOIN test_runs r ON r.workspace_id=l.workspace_id AND r.chat_id=l.chat_id AND r.id=l.run_id
      WHERE b.workspace_id=? AND b.public_id=? AND p.public_id=?`,[auth.workspace_id,batchPublicId,packagePublicId]);
    if(!row)fail('文件包不属于此批次','PACKAGE_NOT_FOUND',404);
    return row;
  });}
  async function listBatches(token,chatPublicId){return scoped(token,async(db,auth)=>{
    const ledger=await ledgerRow(db,auth,chatPublicId);
    if(!ledger)fail('Chat 不存在','CHAT_NOT_FOUND',404);
    const [batches]=await db.execute(`SELECT b.id,b.public_id AS batchId,b.channel_id AS channelId,b.iteration,b.status,b.created_at AS createdAt
      FROM global_case_batches b WHERE b.workspace_id=? AND b.ledger_chat_id=? ORDER BY b.id DESC LIMIT 100`,
      [auth.workspace_id,ledger.chat_id]);
    if(!batches.length)return {chatId:chatPublicId,batches:[]};
    const [packages]=await db.execute(`SELECT l.batch_id AS batchId,p.public_id AS packageId,p.business_date AS businessDate,
      p.delivery_status AS deliveryStatus,p.parse_status AS parseStatus
      FROM global_batch_packages l JOIN exchange_packages p ON p.workspace_id=l.workspace_id
        AND p.channel_id=l.channel_id AND p.id=l.package_id
      WHERE l.workspace_id=? AND l.batch_id IN (${batches.map(()=>'?').join(',')}) ORDER BY p.id`,
      [auth.workspace_id,...batches.map(b=>b.id)]);
    const grouped=new Map();
    for(const p of packages){const key=String(p.batchId);if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push({packageId:p.packageId,businessDate:p.businessDate,
        deliveryStatus:p.deliveryStatus,parseStatus:p.parseStatus});}
    return {chatId:chatPublicId,batches:batches.map(({id,...b})=>({...b,channelId:String(b.channelId),packages:grouped.get(String(id))??[]}))};
  });}
  async function download(token,batchPublicId,packagePublicId){
    const ledger=await batchPackage(token,batchPublicId,packagePublicId);
    return workflow.download(token,ids(ledger),packagePublicId);
  }
  async function inspectPackage(token,batchPublicId,packagePublicId){
    const ledger=await batchPackage(token,batchPublicId,packagePublicId);
    return workflow.inspect(token,ids(ledger),packagePublicId);
  }
  async function confirmDelivery(token,batchPublicId,packagePublicId,input){
    const ledger=await batchPackage(token,batchPublicId,packagePublicId);
    return workflow.deliver(token,ids(ledger),packagePublicId,body(input));
  }
  async function uploadReturns(token,input){
    const imported=await workflow.upload(token,null,body(input));
    const {chats}=await listChats(token);
    const assessments=[];
    for(const chat of chats){
      const {cases}=await listCases(token,chat.chatId);
      for(const row of cases.filter(item=>item.sopStatus==='APPROVED')){
        const state=await caseState(token,row.caseId);
        assessments.push({chatId:chat.chatId,caseId:row.caseId,title:row.title,assessment:state.assessment});
      }
    }
    return {...imported,cases:assessments};
  }
  return {createChat,listChats,endChat,createCase,listCases,proposeSop,approveSop,caseState,requestRetry,data,listData,createData,updateData,deleteData,
    confirmCaseVerdict,progress,generateRound,listBatches,download,inspectPackage,confirmDelivery,uploadReturns};
}
