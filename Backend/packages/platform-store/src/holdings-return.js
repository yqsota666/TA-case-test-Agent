import {assertTaAccountActive} from './ta-reset.js';
import crypto from 'node:crypto';
import { authenticateSession, storeError } from './index.js';
import { exchangeOrderContext } from './exchange-order.js';
import { createExchangeOrderGraph } from '../../case-agent/src/exchange-order-graph.js';
import { createHoldingsParsingGraph, createHoldingsSyncGraph } from '../../case-agent/src/holdings-return-graph.js';
import { volumeUnits, volumeText } from '../../platform-protocol/src/holdings-return.js';
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reject = (code,message) => { throw storeError(code,409,message); };
export function createHoldingsReturnRepository({ transaction }) {
  async function context(db,token,input,write=false) {
    if (![input.chatPublicId,input.casePublicId].every(v=>uuid.test(v??''))) throw storeError('INVALID_INPUT',400,'Chat或Case标识无效');
    const auth = await authenticateSession(db,token);
    const [[owner]] = await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,c.status AS chat_status,k.status AS case_status
      FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
      WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=?${write?' FOR UPDATE':''}`,
      [auth.workspace_id,input.chatPublicId,input.casePublicId]);
    if (!owner) throw storeError('CASE_NOT_FOUND',404,'Case不存在');
    if (write && (owner.chat_status!=='ACTIVE' || ['PASS','FAIL'].includes(owner.case_status))) reject('CASE_NOT_WRITABLE','Chat或Case已结束');
    return { auth,keys:[auth.workspace_id,owner.chat_id,owner.case_id] };
  }
  async function channel(db,workspaceId,id,write=false) {
    if (!/^[1-9]\d{0,18}$/.test(String(id??''))) throw storeError('INVALID_INPUT',400,'通道标识无效');
    const [[row]] = await db.execute(`SELECT id,ta_code,distributor_code,protocol_version FROM exchange_channels
      WHERE workspace_id=? AND id=?${write?' FOR UPDATE':''}`,[workspaceId,id]);
    if (!row) throw storeError('CHANNEL_NOT_FOUND',404,'通道不存在');
    return { id:String(row.id),taCode:row.ta_code,distributorCode:row.distributor_code,protocolVersion:row.protocol_version };
  }
  async function order(db,keys,stepId,businessDate,channelId) {
    const ctx = await exchangeOrderContext(db,keys);
    const candidates = ctx.plan.steps.filter(step=>step.direction==='RECEIVE' && step.fileType==='05' && (!stepId || step.stepId===stepId));
    if (candidates.length!==1) reject('EXCHANGE_STEP_REQUIRED','请明确已确认Plan中的05接收步骤');
    const step = candidates[0];
    const [bound] = await db.execute(`SELECT DISTINCT p.channel_id FROM case_holdings_plan_receipts r
      JOIN case_holdings_return_parses p ON p.workspace_id=r.workspace_id AND p.chat_id=r.chat_id AND p.case_id=r.case_id AND p.id=r.parse_id
      WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? AND r.plan_version=? AND r.step_id=?`,[...keys,ctx.version,step.stepId]);
    if (bound.some(row=>String(row.channel_id)!==String(channelId))) reject('EXCHANGE_STEP_CONFLICT','本05步骤已使用其他通道');
    await createExchangeOrderGraph().invoke({input:{plan:ctx.plan,stepId:step.stepId,direction:'RECEIVE',fileType:'05',businessDate,completed:ctx.events}});
    return {...ctx,step};
  }
  async function read(token,input) {
    return transaction(async db=>{
      const {keys}=await context(db,token,input);
      const [parses]=await db.execute(`SELECT CAST(id AS CHAR) AS parseId,CAST(channel_id AS CHAR) AS channelId,
        parsed_json AS parsed,applied_at AS appliedAt,applied_json AS applied FROM case_holdings_return_parses
        WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`,keys);
      let steps=[];let planningError=null;
      try { const ctx=await exchangeOrderContext(db,keys,false);steps=ctx.plan.steps.filter(s=>s.direction==='RECEIVE' && s.fileType==='05'); }
      catch(e) { if(e.code!=='EXCHANGE_PLAN_REQUIRED')throw e;planningError={error:e.code,message:e.message}; }
      return {steps,planningError,parses:parses.map(p=>({...p,parsed:json(p.parsed),applied:p.applied&&json(p.applied)}))};
    });
  }
  async function parse(token,input,runParsing) {
    const target=await transaction(async db=>{
      const {keys}=await context(db,token,input);
      return channel(db,keys[0],input.channelId);
    });
    const {parsed}=runParsing ? await runParsing(target) : await createHoldingsParsingGraph({channel:target}).invoke({files:input.files});
    return transaction(async db=>{
      const {auth,keys}=await context(db,token,input,true);
      const current=await channel(db,keys[0],input.channelId,true);
      if(JSON.stringify(current)!==JSON.stringify(target))reject('CHANNEL_CHANGED','通道已变更，请重新解析');
      const checked=await order(db,keys,input.exchangeStepId,parsed.result.files[0].date,input.channelId);
      for(const file of parsed.result.files.filter(f=>f.fileType==='05')) {
        const [used]=await db.execute(`SELECT r.step_id FROM case_holdings_plan_receipts r
          JOIN case_holdings_return_parses p ON p.workspace_id=r.workspace_id AND p.chat_id=r.chat_id AND p.case_id=r.case_id AND p.id=r.parse_id
          JOIN case_holdings_return_files f ON f.workspace_id=p.workspace_id AND f.chat_id=p.chat_id AND f.case_id=p.case_id AND f.parse_id=p.id
          WHERE r.workspace_id=? AND r.chat_id=? AND r.case_id=? AND r.plan_version=? AND p.channel_id=? AND f.content_sha256=?`,[...keys,checked.version,input.channelId,file.sha256]);
        if(used.some(row=>row.step_id!==checked.step.stepId))reject('EXCHANGE_STEP_CONFLICT','同一份05原始数据不能重复登记为不同计划轮次');
      }
      const [[prior]]=await db.execute(`SELECT id FROM case_holdings_return_parses WHERE workspace_id=? AND chat_id=? AND case_id=? AND channel_id=? AND content_sha256=? FOR UPDATE`,[...keys,input.channelId,parsed.result.sha256]);
      let parseId=prior?.id;
      if(!prior) {
        for(const file of parsed.rawFiles) {
          const [conflicts]=await db.execute(`SELECT f.content_sha256 FROM case_holdings_return_files f
            JOIN case_holdings_return_parses p ON p.workspace_id=f.workspace_id AND p.chat_id=f.chat_id AND p.case_id=f.case_id AND p.id=f.parse_id
            WHERE p.workspace_id=? AND p.channel_id=? AND f.file_name=?`,[keys[0],input.channelId,file.fileName]);
          if(conflicts.some(row=>row.content_sha256!==file.sha256))reject('FILE_NAME_CONFLICT','同通道同名05文件内容不同，请使用TA原始更正文件');
        }
        const [saved]=await db.execute(`INSERT INTO case_holdings_return_parses
          (workspace_id,chat_id,case_id,channel_id,content_sha256,parsed_json,actor_user_id) VALUES (?,?,?,?,?,?,?)`,
          [...keys,input.channelId,parsed.result.sha256,JSON.stringify(parsed.result),auth.user_id]);
        parseId=saved.insertId;
        for(const file of parsed.rawFiles) await db.execute(`INSERT INTO case_holdings_return_files
          (workspace_id,chat_id,case_id,parse_id,file_name,content_sha256,raw_bytes) VALUES (?,?,?,?,?,?,?)`,
          [...keys,parseId,file.fileName,file.sha256,file.rawBytes]);
      }
      await db.execute(`INSERT IGNORE INTO case_holdings_plan_receipts (workspace_id,chat_id,case_id,plan_version,step_id,parse_id) VALUES (?,?,?,?,?,?)`,[...keys,checked.version,checked.step.stepId,parseId]);
      return {parseId:String(parseId),duplicate:Boolean(prior),parsed:parsed.result,phase:'PARSED'};
    });
  }
  async function apply(token,input) {
    if(!/^[1-9]\d{0,18}$/.test(String(input.parseId??'')))throw storeError('INVALID_INPUT',400,'解析标识无效');
    return transaction(async db=>{
      const {keys}=await context(db,token,input,true);
      const [[p]]=await db.execute(`SELECT channel_id,parsed_json,content_sha256,applied_json FROM case_holdings_return_parses
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=? FOR UPDATE`,[...keys,input.parseId]);
      if(!p)throw storeError('PARSE_NOT_FOUND',404,'05解析不存在');
      const ch=await channel(db,keys[0],p.channel_id,true);
      const [files]=await db.execute(`SELECT file_name,content_sha256,raw_bytes FROM case_holdings_return_files
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND parse_id=? ORDER BY file_name FOR UPDATE`,[...keys,input.parseId]);
      if(files.some(file=>hash(file.raw_bytes)!==file.content_sha256))reject('RETURN_SOURCE_INVALID','05原文件摘要不一致');
      const {parsed}=await createHoldingsParsingGraph({channel:ch,allowMixed:Boolean(json(p.parsed_json).mixedPackage)}).invoke({files:files.map(f=>({fileName:f.file_name,base64:f.raw_bytes.toString('base64')}))});
      if(parsed.result.sha256!==p.content_sha256)reject('RETURN_SOURCE_INVALID','05原始包不完整');
      const checked=await order(db,keys,input.exchangeStepId,parsed.result.files[0].date,p.channel_id);
      if(!checked.events.some(e=>e.stepId===checked.step.stepId && e.holdingsParseId===String(input.parseId)))reject('ORDER_VIOLATION','此05尚未通过当前Plan的上传时序校验');
      if(p.applied_json)return {...json(p.applied_json),duplicate:true};
      const state=await createHoldingsSyncGraph({channel:ch,sync:async rows=>{
        const results=[];
        for(const row of rows) {
          if(row.status!=='READY'){results.push({fileName:row.fileName,recordIndex:row.localIndex,status:row.status});continue;}
          const r=row.record;
          const [[account]]=await db.execute(`SELECT id FROM sales_confirmed_accounts WHERE workspace_id=? AND channel_id=?
            AND transaction_account_id=? AND ta_account_id=? AND branch_code=? FOR UPDATE`,[keys[0],p.channel_id,r.TransactionAccountID,r.TAAccountID,r.BranchCode]);
          if(!account)reject('SALES_ACCOUNT_UNCONFIRMED','05账户或网点没有匹配的正式开户确认；整包未同步');
          await assertTaAccountActive(db,keys[0],p.channel_id,account.id);
          const hk=[keys[0],p.channel_id,account.id,r.FundCode,r.ShareClass];
          const [[holding]]=await db.execute(`SELECT DATE_FORMAT(snapshot_date,'%Y%m%d') AS snapshot_date,snapshot_total,snapshot_available,snapshot_frozen
            FROM sales_confirmed_holdings WHERE workspace_id=? AND channel_id=? AND account_id=? AND fund_code=? AND share_class=? FOR UPDATE`,hk);
          if(holding?.snapshot_date>row.date)reject('STALE_HOLDING_SNAPSHOT','05早于已经同步的持仓基准；整包未同步');
          const sameDate=holding?.snapshot_date===row.date;
          if(sameDate && (holding.snapshot_total!==row.total || holding.snapshot_available!==row.available || holding.snapshot_frozen!==row.frozen))reject('HOLDING_SNAPSHOT_CONFLICT','同日05账户余额不同，需要单独更正；整包未同步');
          const [[later]]=await db.execute(`SELECT COALESCE(SUM(confirmed_volume),0) AS volume,COUNT(*) AS n FROM sales_confirmed_transactions
            WHERE workspace_id=? AND channel_id=? AND account_id=? AND fund_code=? AND share_class=? AND confirmation_date>STR_TO_DATE(?,'%Y%m%d')`,[...hk,row.date]);
          const total=volumeText(volumeUnits(row.total)+volumeUnits(String(later.volume)));
          if(!sameDate)await db.execute(`INSERT INTO sales_confirmed_holdings
            (workspace_id,channel_id,account_id,fund_code,share_class,total_volume,snapshot_date,snapshot_total,snapshot_available,snapshot_frozen,snapshot_parse_id,available_volume,frozen_volume)
            VALUES (?,?,?,?,?,?,STR_TO_DATE(?,'%Y%m%d'),?,?,?,?,?,?) ON DUPLICATE KEY UPDATE total_volume=VALUES(total_volume),snapshot_date=VALUES(snapshot_date),
            snapshot_total=VALUES(snapshot_total),snapshot_available=VALUES(snapshot_available),snapshot_frozen=VALUES(snapshot_frozen),snapshot_parse_id=VALUES(snapshot_parse_id),available_volume=VALUES(available_volume),frozen_volume=VALUES(frozen_volume)`,
            [...hk,total,row.date,row.total,row.available,row.frozen,input.parseId,Number(later.n)?null:row.available,Number(later.n)?null:row.frozen]);
          results.push({fileName:row.fileName,recordIndex:row.localIndex,status:sameDate?'UNCHANGED':'SYNCED',transactionAccountId:r.TransactionAccountID,fundCode:r.FundCode,shareClass:r.ShareClass,totalVolume:total,snapshotDate:row.date});
        }
        return {businessApplied:results.some(r=>['SYNCED','UNCHANGED'].includes(r.status)),results};
      }}).invoke({parsed:parsed.result});
      await db.execute(`UPDATE case_holdings_return_parses SET applied_at=CURRENT_TIMESTAMP(3),applied_json=? WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,[JSON.stringify(state.result),...keys,input.parseId]);
      return {...state.result,duplicate:false};
    });
  }
  return Object.freeze({read,parse,apply});
}
