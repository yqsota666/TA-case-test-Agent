import {readPredecessorContext} from './predecessor-context.js';
import { isDeepStrictEqual } from 'node:util';
import { validPlanContract } from '../../platform-protocol/src/plan-contract.js';
import crypto from 'node:crypto';
import { validExchangePlan } from '../../platform-protocol/src/exchange-plan.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

export function storeError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function requiredUuid(value, name) {
  if (typeof value !== 'string' || !uuid.test(value)) {
    throw storeError('INVALID_ID', 400, `${name} 无效`);
  }
  return value.toLowerCase();
}

function titleText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
    throw storeError('INVALID_TITLE', 400, '标题须为 1–160 个字符');
  }
  return value.trim();
}

function validPlanText(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1000 &&
    value.trim() === value &&
    !/[\r\n]|\*\*|__|`|\*[^*\n]+\*|(?<![A-Za-z0-9_])_[^_\n]+_(?![A-Za-z0-9_])|\[[^\]\n]+\]\([^)\n]+\)|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(value);
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validSopPlan(plan) {
  if (plan && Object.hasOwn(plan, 'contract')) {
    const { contract, ...base } = plan;
    return validSopPlan(base) && validPlanContract(contract, base);
  }
  return (hasExactKeys(plan, ['objective', 'preconditions', 'scenarios', 'openQuestions']) ||
      (hasExactKeys(plan, ['objective', 'preconditions', 'scenarios', 'openQuestions', 'exchangePlan']) && validExchangePlan(plan.exchangePlan))) &&
    validPlanText(plan.objective) &&
    Array.isArray(plan.preconditions) && plan.preconditions.length <= 50 &&
    plan.preconditions.every(validPlanText) &&
    Array.isArray(plan.scenarios) && plan.scenarios.length >= 1 && plan.scenarios.length <= 100 &&
    plan.scenarios.every(scenario =>
      hasExactKeys(scenario, ['title', 'setup', 'action', 'expected', 'evidence']) &&
      ['title', 'setup', 'action', 'expected', 'evidence'].every(key => validPlanText(scenario[key]))) &&
    Array.isArray(plan.openQuestions) && plan.openQuestions.length <= 50 &&
    plan.openQuestions.every(validPlanText);
}

export function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function authenticateSession(db, token) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) {
    throw storeError('UNAUTHENTICATED', 401, '请先登录');
  }
  const [[user]] = await db.execute(`SELECT u.id AS user_id, w.id AS workspace_id
    FROM platform_sessions s
    JOIN platform_users u ON u.id=s.user_id AND u.status='ACTIVE'
    JOIN workspaces w ON w.owner_user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)`, [sessionTokenHash(token)]);
  if (!user) throw storeError('UNAUTHENTICATED', 401, '登录状态已失效');
  return Object.freeze(user);
}

// The caller supplies a transaction over one connection. No method accepts a
// client-supplied workspace ID or exposes that connection to an HTTP handler.
export function createCaseRepository({ transaction }) {
  if (typeof transaction !== 'function') throw new TypeError('transaction is required');

  async function createChat(token, title) {
    const cleanTitle = titleText(title);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const publicId = crypto.randomUUID();
      const [result] = await db.execute(`INSERT INTO case_chats(public_id,workspace_id,title)
        VALUES (?,?,?)`, [publicId, auth.workspace_id, cleanTitle]);
      await db.execute(`INSERT INTO chat_state_events
        (workspace_id,chat_id,to_status,actor_user_id) VALUES (?,?,'ACTIVE',?)`,
      [auth.workspace_id, result.insertId, auth.user_id]);
      return { publicId };
    });
  }

  async function assertCaseWritable(token,chatPublicId,casePublicId,{discussion=false}={}){
    chatPublicId=requiredUuid(chatPublicId,'Chat');casePublicId=requiredUuid(casePublicId,'Case');
    return transaction(async db=>{
      const auth=await authenticateSession(db,token);
      const [[owner]]=await db.execute(`SELECT c.status AS chat_status,k.status AS case_status FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=? FOR UPDATE`,[auth.workspace_id,chatPublicId,casePublicId]);
      if(!owner)throw storeError('CASE_NOT_FOUND',404,'Case不存在');
      if(owner.chat_status!=='ACTIVE'||['PASS','FAIL'].includes(owner.case_status)||(discussion&&!['DISCUSSING','SOP_PENDING'].includes(owner.case_status)))throw storeError('CASE_NOT_WRITABLE',409,'Chat或Case已封存，不能继续Agent动作');
      return {writable:true};
    });
  }

  async function listChats(token) {
    return transaction(async db=>{
      const auth=await authenticateSession(db,token);
      const [chats]=await db.execute('SELECT public_id,title,status,close_reason,closed_at,created_at FROM case_chats WHERE workspace_id=? ORDER BY id DESC LIMIT 200',[auth.workspace_id]);
      return {chats};
    });
  }

  async function createCase(token, chatPublicId, title) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    const cleanTitle = titleText(title);
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[batch]]=await db.execute('SELECT id FROM exchange_batches WHERE workspace_id=? AND chat_id=? LIMIT 1 FOR UPDATE',[auth.workspace_id,chat.id]);
      if(batch?.id) throw storeError('CHAT_EXECUTION_STARTED',409,'Chat已建立发文批次；新增业务请另开Chat，失败后续请使用关联复测');
      const publicId = crypto.randomUUID();
      const [result] = await db.execute(`INSERT INTO cases
        (public_id,workspace_id,chat_id,title) VALUES (?,?,?,?)`,
      [publicId, auth.workspace_id, chat.id, cleanTitle]);
      await db.execute(`INSERT INTO case_state_events
        (workspace_id,chat_id,case_id,to_status,actor_user_id)
        VALUES (?,?,?,'DISCUSSING',?)`,
      [auth.workspace_id, chat.id, result.insertId, auth.user_id]);
      return { publicId };
    });
  }

  async function listCases(token, chatPublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status,title FROM case_chats
        WHERE workspace_id=? AND public_id=?`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      const [cases] = await db.execute(`SELECT public_id,title,status,created_at
        FROM cases WHERE workspace_id=? AND chat_id=? ORDER BY id`,
      [auth.workspace_id, chat.id]);
      return { chat: { title: chat.title, status: chat.status }, cases };
    });
  }

  async function saveSopProposal(token, chatPublicId, casePublicId, proposal) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!validSopPlan(proposal)) {
      throw storeError('INVALID_PLAN', 400, 'Plan 提案无效');
    }
    const planJson = JSON.stringify(proposal);
    if (!planJson || planJson.length > 100000) {
      throw storeError('INVALID_PLAN', 400, 'Plan 提案无效或过长');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (!['DISCUSSING', 'SOP_PENDING'].includes(caseRow.status)) {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能提交 Plan 提案');
      }
      const [[latestTurn]] = await db.execute(`SELECT status FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY turn_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (latestTurn?.status === 'PENDING') {
        throw storeError('DISCUSSION_IN_PROGRESS', 409, '请先完成当前讨论');
      }
      const [[latest]] = await db.execute(`SELECT id,version_number,status FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (latest?.status === 'LOCKED') throw storeError('SOP_LOCKED', 409, 'SOP 已锁定');
      if (latest?.status === 'PENDING_CONFIRMATION') {
        await db.execute(`UPDATE case_sop_versions SET status='DRAFT'
          WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id, latest.id]);
      }
      const versionNumber = (latest?.version_number ?? 0) + 1;
      await db.execute(`INSERT INTO case_sop_versions
        (workspace_id,chat_id,case_id,version_number,plan_json,status)
        VALUES (?,?,?,?,?,'PENDING_CONFIRMATION')`,
      [auth.workspace_id, chat.id, caseRow.id, versionNumber, planJson]);
      if (caseRow.status === 'DISCUSSING') {
        await db.execute(`UPDATE cases SET status='SOP_PENDING'
          WHERE workspace_id=? AND chat_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id]);
        await db.execute(`INSERT INTO case_state_events
          (workspace_id,chat_id,case_id,from_status,to_status,reason)
          VALUES (?,?,?,'DISCUSSING','SOP_PENDING','AI_PLAN_PROPOSAL')`,
        [auth.workspace_id, chat.id, caseRow.id]);
      }
      return { versionNumber, status: 'PENDING_CONFIRMATION' };
    });
  }

  async function getLatestSopProposal(token, chatPublicId, casePublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id FROM case_chats
        WHERE workspace_id=? AND public_id=?`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      const [[caseRow]] = await db.execute(`SELECT id FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=?`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const [[latest]] = await db.execute(`SELECT version_number,plan_json,status,locked_at,source_turn_number
        FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (!latest) return null;
      const [confirmations] = await db.execute(`SELECT section,confirmed_at AS confirmedAt FROM case_plan_section_confirmations
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND version_number=? ORDER BY section`,
      [auth.workspace_id,chat.id,caseRow.id,latest.version_number]);
      return { confirmations, versionNumber: latest.version_number, status: latest.status,
        proposal: typeof latest.plan_json === 'string' ? JSON.parse(latest.plan_json) : latest.plan_json,
        lockedAt: latest.locked_at, sourceTurnNumber: latest.source_turn_number };
    });
  }

  async function confirmSopProposal(token, chatPublicId, casePublicId, versionNumber, section) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
      throw storeError('INVALID_VERSION', 400, 'Plan 版本号无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (caseRow.status !== 'SOP_PENDING') {
        throw storeError('INVALID_CASE_STATE', 409, 'Case 尚无待确认的 Plan');
      }
      const [[latest]] = await db.execute(`SELECT id,version_number,plan_json,status
        FROM case_sop_versions WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (!latest || latest.version_number !== versionNumber || latest.status !== 'PENDING_CONFIRMATION') {
        throw storeError('STALE_PLAN', 409, 'Plan 已更新，请重新审阅最新版本');
      }
      const plan = typeof latest.plan_json === 'string' ? JSON.parse(latest.plan_json) : latest.plan_json;
      if (!validSopPlan(plan)) {
        throw storeError('INVALID_PLAN', 409, '已保存的 Plan 结构无效，请重新生成');
      }
      if (!plan.exchangePlan || plan.exchangePlan.status !== 'READY') {
        throw storeError('EXCHANGE_PLAN_REQUIRED',409,'请先讨论文件的轮次、业务时间和顺序，再确认 Plan');
      }
      if (plan.openQuestions.length) {
        throw storeError('PLAN_HAS_OPEN_QUESTIONS', 409, '请先解决 Plan 中的待确认事项');
      }
      if (!plan.contract || !validPlanContract(plan.contract,plan)) {
        throw storeError('PLAN_CONTRACT_REQUIRED',409,'请重新生成带准备数据和结构化预期的Plan');
      }
      if (![ 'DATA','EXPECTATIONS' ].includes(section)) {
        throw storeError('PLAN_SECTION_REQUIRED',400,'请明确确认准备数据或预期结果');
      }
      if (plan.contract.dataSpecification.missing.length || (section==='EXPECTATIONS' && plan.contract.missing.length)) {
        throw storeError('PLAN_HAS_OPEN_QUESTIONS',409,'准备数据或预期还有待澄清事项');
      }
      const keys=[auth.workspace_id,chat.id,caseRow.id,versionNumber];
      const [confirmed] = await db.execute(`SELECT section FROM case_plan_section_confirmations
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND version_number=? FOR UPDATE`,keys);
      if (section==='EXPECTATIONS' && !confirmed.some(r=>r.section==='DATA')) {
        throw storeError('PLAN_DATA_CONFIRMATION_REQUIRED',409,'请先确认准备数据');
      }
      if (!confirmed.some(r=>r.section===section)) await db.execute(`INSERT INTO case_plan_section_confirmations
        (workspace_id,chat_id,case_id,version_number,section,actor_user_id) VALUES (?,?,?,?,?,?)`,
      [...keys,section,auth.user_id]);
      if (section==='DATA') return {versionNumber,status:'PENDING_CONFIRMATION',phase:'AWAITING_EXPECTATIONS'};
      await db.execute(`UPDATE case_sop_versions SET status='LOCKED',locked_at=UTC_TIMESTAMP(3)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
      [auth.workspace_id, chat.id, caseRow.id, latest.id]);
      await db.execute(`UPDATE cases SET status='SOP_LOCKED'
        WHERE workspace_id=? AND chat_id=? AND id=?`,
      [auth.workspace_id, chat.id, caseRow.id]);
      await db.execute(`INSERT INTO case_state_events
        (workspace_id,chat_id,case_id,from_status,to_status,actor_user_id,reason)
        VALUES (?,?,?,'SOP_PENDING','SOP_LOCKED',?,'USER_CONFIRMED_PLAN')`,
      [auth.workspace_id, chat.id, caseRow.id, auth.user_id]);
      return { versionNumber, status: 'LOCKED', phase: 'SOP_LOCKED' };
    });
  }

  async function readCaseDiscussion(token, chatPublicId, casePublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=?`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      const [[caseRow]] = await db.execute(`SELECT id,status,predecessor_case_id FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=?`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const [rows] = await db.execute(`SELECT turn_number,user_text,assistant_text,status,turn_kind
        FROM case_discussion_turns WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY turn_number`, [auth.workspace_id, chat.id, caseRow.id]);
      const turns = [];
      let pending = null;
      for (const [index, row] of rows.entries()) {
        if (Number(row.turn_number) !== index + 1) {
          throw storeError('CORRUPT_HISTORY', 500, 'Case 讨论记录不连续');
        }
        if (row.status === 'COMPLETE') {
          turns.push({ role: 'user', content: row.user_text },
            { role: 'assistant', content: row.assistant_text });
        } else if (row.status === 'PENDING' && index === rows.length - 1) {
          pending = { turnNumber: Number(row.turn_number), userInput: row.user_text, kind: row.turn_kind };
        } else if (row.status !== 'ABANDONED') {
          throw storeError('CORRUPT_HISTORY', 500, 'Case 讨论记录状态无效');
        }
      }
      const sourceContext=await readPredecessorContext(db,[auth.workspace_id,chat.id],caseRow.predecessor_case_id);
      return { revision: rows.length, turns, pending,...(sourceContext?{sourceContext}:{}) };
    });
  }

  async function beginCaseDiscussionTurn(token, chatPublicId, casePublicId,
    { expectedRevision, userInput, kind = 'DISCUSS' }) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 0xffffffff ||
        typeof userInput !== 'string' || !userInput.trim() || userInput.length > 4000 ||
        !['DISCUSS', 'PROPOSE_PLAN'].includes(kind)) {
      throw storeError('INVALID_DISCUSSION_TURN', 400, '讨论输入或版本无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (!['DISCUSSING', 'SOP_PENDING'].includes(caseRow.status)) {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能继续讨论');
      }
      const [[latestTurn]] = await db.execute(`SELECT turn_number,status FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY turn_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (Number(latestTurn?.turn_number ?? 0) !== expectedRevision) {
        throw storeError('STALE_DISCUSSION', 409, '讨论已有新回复，请重新读取');
      }
      if (latestTurn?.status === 'PENDING') {
        throw storeError('DISCUSSION_IN_PROGRESS', 409, '上一轮讨论尚未完成');
      }
      if (caseRow.status === 'SOP_PENDING') {
        const [[latestSop]] = await db.execute(`SELECT id,status FROM case_sop_versions
          WHERE workspace_id=? AND chat_id=? AND case_id=?
          ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
        [auth.workspace_id, chat.id, caseRow.id]);
        if (latestSop?.status !== 'PENDING_CONFIRMATION') {
          throw storeError('INVALID_CASE_STATE', 409, '待确认 Plan 状态不一致');
        }
        await db.execute(`UPDATE case_sop_versions SET status='DRAFT'
          WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id, latestSop.id]);
        await db.execute(`UPDATE cases SET status='DISCUSSING'
          WHERE workspace_id=? AND chat_id=? AND id=?`,
        [auth.workspace_id, chat.id, caseRow.id]);
        await db.execute(`INSERT INTO case_state_events
          (workspace_id,chat_id,case_id,from_status,to_status,actor_user_id,reason)
          VALUES (?,?,?,'SOP_PENDING','DISCUSSING',?,'USER_REVISED_PLAN')`,
        [auth.workspace_id, chat.id, caseRow.id, auth.user_id]);
      }
      const revision = expectedRevision + 1;
      await db.execute(`INSERT INTO case_discussion_turns
        (workspace_id,chat_id,case_id,turn_number,user_text,actor_user_id,turn_kind)
        VALUES (?,?,?,?,?,?,?)`,
      [auth.workspace_id, chat.id, caseRow.id, revision, userInput.trim(), auth.user_id, kind]);
      return { revision, turnNumber: revision };
    });
  }

  async function finishCaseDiscussionTurn(token, chatPublicId, casePublicId,
    { turnNumber, assistantReply, promptVersion }) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(turnNumber) || turnNumber < 1 ||
        typeof assistantReply !== 'string' || !assistantReply.trim() || assistantReply.length > 4000 ||
        typeof promptVersion !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(promptVersion)) {
      throw storeError('INVALID_DISCUSSION_TURN', 400, '讨论回复或版本无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (caseRow.status !== 'DISCUSSING') {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能完成讨论');
      }
      const [[turn]] = await db.execute(`SELECT status,turn_kind FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=? FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      if (turn?.status !== 'PENDING' || turn.turn_kind !== 'DISCUSS') {
        throw storeError('STALE_DISCUSSION', 409, '讨论回合已完成或已取消');
      }
      await db.execute(`UPDATE case_discussion_turns
        SET assistant_text=?,prompt_version=?,status='COMPLETE',finished_at=UTC_TIMESTAMP(3)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=?`,
      [assistantReply, promptVersion, auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      return { revision: turnNumber };
    });
  }

  async function abandonCaseDiscussionTurn(token, chatPublicId, casePublicId, turnNumber) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(turnNumber) || turnNumber < 1) {
      throw storeError('INVALID_DISCUSSION_TURN', 400, '讨论轮次无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (caseRow.status !== 'DISCUSSING') {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能取消讨论');
      }
      const [[turn]] = await db.execute(`SELECT status FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=? FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      if (turn?.status !== 'PENDING') {
        throw storeError('STALE_DISCUSSION', 409, '讨论回合已完成或已取消');
      }
      await db.execute(`UPDATE case_discussion_turns
        SET status='ABANDONED',finished_at=UTC_TIMESTAMP(3)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=?`,
      [auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      return { revision: turnNumber };
    });
  }

  async function finishCasePlanProposal(token, chatPublicId, casePublicId,
    { turnNumber, assistantReply, promptVersion, proposal }) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(turnNumber) || turnNumber < 1 ||
        typeof assistantReply !== 'string' || !assistantReply.trim() || assistantReply.length > 120000 ||
        typeof promptVersion !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(promptVersion) ||
        !validSopPlan(proposal)) {
      throw storeError('INVALID_PLAN', 400, 'Plan 提案或讨论回复无效');
    }
    const planJson = JSON.stringify(proposal);
    if (planJson.length > 100000) throw storeError('INVALID_PLAN', 400, 'Plan 提案过长');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (caseRow.status !== 'DISCUSSING') {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能提交 Plan 提案');
      }
      const [[turn]] = await db.execute(`SELECT status,turn_kind FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=? FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      if (turn?.status !== 'PENDING' || turn.turn_kind !== 'PROPOSE_PLAN') {
        throw storeError('STALE_DISCUSSION', 409, 'Plan 提案回合已完成或类型不符');
      }
      const [[history]] = await db.execute(`SELECT COUNT(*) AS count FROM case_discussion_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number<? AND status='COMPLETE'`,
      [auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      if (Number(history.count) < 2) {
        throw storeError('INSUFFICIENT_DISCUSSION', 409, 'Plan 提案前至少需要两轮完整讨论');
      }
      const [[latest]] = await db.execute(`SELECT id,version_number,status FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=?
        ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
      [auth.workspace_id, chat.id, caseRow.id]);
      if (latest?.status === 'LOCKED' || latest?.status === 'PENDING_CONFIRMATION') {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 已有不可覆盖的 SOP');
      }
      const versionNumber = (latest?.version_number ?? 0) + 1;
      await db.execute(`INSERT INTO case_sop_versions
        (workspace_id,chat_id,case_id,version_number,plan_json,status,source_turn_number)
        VALUES (?,?,?,?,?,'PENDING_CONFIRMATION',?)`,
      [auth.workspace_id, chat.id, caseRow.id, versionNumber, planJson, turnNumber]);
      await db.execute(`UPDATE case_discussion_turns
        SET assistant_text=?,prompt_version=?,status='COMPLETE',finished_at=UTC_TIMESTAMP(3)
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND turn_number=?`,
      [assistantReply, promptVersion, auth.workspace_id, chat.id, caseRow.id, turnNumber]);
      await db.execute(`UPDATE cases SET status='SOP_PENDING'
        WHERE workspace_id=? AND chat_id=? AND id=?`,
      [auth.workspace_id, chat.id, caseRow.id]);
      await db.execute(`INSERT INTO case_state_events
        (workspace_id,chat_id,case_id,from_status,to_status,reason)
        VALUES (?,?,?,'DISCUSSING','SOP_PENDING','AI_PLAN_PROPOSAL')`,
      [auth.workspace_id, chat.id, caseRow.id]);
      return { revision: turnNumber, versionNumber, status: 'PENDING_CONFIRMATION' };
    });
  }

  async function generatedData(token, chatPublicId, casePublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[row]] = await db.execute(`SELECT c.id AS case_id,c.chat_id
        FROM cases c JOIN case_chats h ON h.workspace_id=c.workspace_id AND h.id=c.chat_id
        WHERE c.workspace_id=? AND h.public_id=? AND c.public_id=?`,
      [auth.workspace_id, chatPublicId, casePublicId]);
      if (!row) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      return readGeneratedData(db, [auth.workspace_id, row.chat_id, row.case_id]);
    });
  }

  async function generatedDataCatalog(token) {
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [rows] = await db.execute(`SELECT h.public_id AS chat_public_id,h.title AS chat_title,
        c.public_id AS case_public_id,c.title AS case_title,c.status AS case_status,
        e.created_at AS generated_at
        FROM case_chats h JOIN cases c ON c.workspace_id=h.workspace_id AND c.chat_id=h.id
        LEFT JOIN case_data_executions e ON e.workspace_id=c.workspace_id
          AND e.chat_id=c.chat_id AND e.case_id=c.id
        WHERE h.workspace_id=? ORDER BY h.id DESC,c.id`, [auth.workspace_id]);
      return { items: rows.map(row => ({ chatId: row.chat_public_id,
        chatTitle: row.chat_title, caseId: row.case_public_id,
        caseTitle: row.case_title, caseStatus: row.case_status,
        generatedAt: row.generated_at })) };
    });
  }

  async function executeGeneratedData(token, chatPublicId, casePublicId,
    versionNumber, specification, runGraph) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(versionNumber) || versionNumber < 1 ||
        typeof runGraph !== 'function') throw storeError('INVALID_INPUT', 400, '执行参数无效');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const keys = [auth.workspace_id, chat.id, caseRow.id];
      const [[prior]] = await db.execute(`SELECT sop_version_id FROM case_data_executions
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (prior) return { ...await readGeneratedData(db, keys), replayed: true };
      if (caseRow.status !== 'SOP_LOCKED') {
        throw storeError('PLAN_NOT_CONFIRMED', 409, '须先确认 Plan');
      }
      const [[plan]] = await db.execute(`SELECT id,plan_json FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND version_number=? AND status='LOCKED' FOR UPDATE`,
      [...keys, versionNumber]);
      if (!plan) throw storeError('PLAN_VERSION_CONFLICT', 409, '已确认的 Plan 版本不匹配');
      const lockedPlan=typeof plan.plan_json==='string'?JSON.parse(plan.plan_json):plan.plan_json;
      if (lockedPlan?.contract && !isDeepStrictEqual(specification,lockedPlan.contract.dataSpecification)) {
        throw storeError('PLAN_DATA_MISMATCH',409,'必须使用已确认Plan中的原始数据定义');
      }
      await db.execute(`INSERT INTO case_data_executions
        (workspace_id,chat_id,case_id,sop_version_id,specification_json)
        VALUES (?,?,?,?,?)`, [...keys, plan.id, JSON.stringify(specification)]);
      const state = await runGraph(db, { workspaceId: auth.workspace_id,
        chatId: chat.id, caseId: caseRow.id }, specification);
      if (!state.validated) throw new Error('数据校验节点未完成');
      return readGeneratedData(db, keys);
    });
  }

  async function readGeneratedData(db, keys) {
    const [[execution]] = await db.execute(`SELECT sop_version_id,created_at,
      (SELECT JSON_CONTAINS_PATH(v.plan_json,'one','$.contract') FROM case_sop_versions v
       WHERE v.workspace_id=case_data_executions.workspace_id AND v.chat_id=case_data_executions.chat_id
        AND v.case_id=case_data_executions.case_id AND v.id=case_data_executions.sop_version_id) AS plan_data_frozen
      FROM case_data_executions WHERE workspace_id=? AND chat_id=? AND case_id=?`, keys);
    if (!execution) return { status: 'NOT_STARTED', reviewStatus: 'NOT_STARTED', revision: 0,
      customers: [], accounts: [], funds: [], holdings: [] };
    const [customers] = await db.execute(`SELECT id,public_id,workspace_id,chat_id,case_id,
      name,investor_type,simulated_balance
      FROM case_generated_customers WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [accounts] = await db.execute(`SELECT id,workspace_id,chat_id,case_id,customer_id,account_no,branch_code
      FROM case_generated_accounts WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [funds] = await db.execute(`SELECT id,workspace_id,chat_id,case_id,fund_code,fund_name,share_class,nav
      FROM case_generated_funds WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [holdings] = await db.execute(`SELECT id,workspace_id,chat_id,case_id,account_id,fund_code,share_class,total_volume
      FROM case_generated_holdings WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [[edit]] = await db.execute(`SELECT COALESCE(MAX(revision),0) AS revision
      FROM case_data_edit_events WHERE workspace_id=? AND chat_id=? AND case_id=?`, keys);
    const [[confirmation]] = await db.execute(`SELECT revision,confirmed_at
      FROM case_data_confirmations WHERE workspace_id=? AND chat_id=? AND case_id=?`, keys);
    return { ...(Number(execution.plan_data_frozen)?{planDataFrozen:true}:{}),status: 'VALIDATED', purpose: 'APPLICATION_DRAFT', businessApplied: false, planVersionId: String(execution.sop_version_id),
      reviewStatus: confirmation ? 'CONFIRMED' : 'PENDING_REVIEW',
      confirmedAt: confirmation?.confirmed_at ?? null,
      createdAt: execution.created_at, revision: Number(edit.revision), customers, accounts, funds, holdings };
  }

  async function editGeneratedData(token, chatPublicId, casePublicId, edit, reviewTurn = null) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id, chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=?`,
      [auth.workspace_id, chat.id, casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const keys = [auth.workspace_id, chat.id, caseRow.id];
      const [[execution]] = await db.execute(`SELECT sop_version_id FROM case_data_executions
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (!execution) throw storeError('DATA_NOT_STARTED', 409, '请先生成数据');
      const [[locked]] = await db.execute(`SELECT plan_json FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,[...keys,execution.sop_version_id]);
      const lockedPlan=typeof locked?.plan_json==='string'?JSON.parse(locked.plan_json):locked?.plan_json;
      if (lockedPlan?.contract) throw storeError('PLAN_DATA_FROZEN',409,'准备数据已在Plan中确认并锁定；请新建Case讨论修改后的方案');
      const [[confirmation]] = await db.execute(`SELECT revision FROM case_data_confirmations
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (confirmation) throw storeError('DATA_ALREADY_CONFIRMED', 409, '数据已确认，不能继续修改');
      const [[latest]] = await db.execute(`SELECT COALESCE(MAX(revision),0) AS revision
        FROM case_data_edit_events WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (Number(latest.revision) !== edit.revision) {
        throw storeError('DATA_EDIT_CONFLICT', 409, '数据已被其他修改更新，请刷新后重试');
      }
      for (const row of edit.changes.customers) {
        if (row.id === null) {
          const [created] = await db.execute(`INSERT INTO case_generated_customers
            (public_id,workspace_id,chat_id,case_id,name,investor_type,simulated_balance)
            VALUES (?,?,?,?,?,?,?)`, [crypto.randomUUID(), ...keys, row.name,
            row.investorType, row.simulatedBalance]);
          const accountNo = `9${Array.from({ length: 16 }, () => crypto.randomInt(10)).join('')}`;
          await db.execute(`INSERT INTO case_generated_accounts
            (workspace_id,chat_id,case_id,customer_id,account_no,branch_code)
            VALUES (?,?,?,?,?,?)`, [...keys, created.insertId, accountNo, row.branchCode]);
        } else {
          const [result] = await db.execute(`UPDATE case_generated_customers
            SET name=?,investor_type=?,simulated_balance=?
            WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`,
          [row.name, row.investorType, row.simulatedBalance, ...keys, row.id]);
          if (!result.affectedRows) throw storeError('DATA_ROW_NOT_FOUND', 404, '客户记录不存在');
        }
      }
      for (const row of edit.changes.accounts) {
        if (row.id === null) {
          const [[customer]] = await db.execute(`SELECT id FROM case_generated_customers
            WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?`, [...keys,row.customerId]);
          if (!customer) throw storeError('DATA_ROW_NOT_FOUND', 404, '客户记录不存在');
          const accountNo = `9${Array.from({ length: 16 }, () => crypto.randomInt(10)).join('')}`;
          await db.execute(`INSERT INTO case_generated_accounts
            (workspace_id,chat_id,case_id,customer_id,account_no,branch_code)
            VALUES (?,?,?,?,?,?)`, [...keys,row.customerId,accountNo,row.branchCode]);
          continue;
        }
        const [result] = await db.execute(`UPDATE case_generated_accounts SET branch_code=?
          WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=? AND customer_id=?`,
        [row.branchCode, ...keys, row.id, row.customerId]);
        if (!result.affectedRows) throw storeError('DATA_ROW_NOT_FOUND', 404, '账户记录不存在');
      }
      for (const row of edit.changes.funds) {
        if (row.id === null) {
          await db.execute(`INSERT INTO case_generated_funds
            (workspace_id,chat_id,case_id,fund_code,fund_name,share_class,nav)
            VALUES (?,?,?,?,?,?,?)`, [...keys, row.fundCode, row.fundName,row.shareClass,row.nav]);
        } else {
          const [result] = await db.execute(`UPDATE case_generated_funds SET fund_name=?,nav=?
            WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?
              AND fund_code=? AND share_class=?`,
          [row.fundName,row.nav,...keys,row.id,row.fundCode,row.shareClass]);
          if (!result.affectedRows) throw storeError('DATA_ROW_NOT_FOUND', 404, '基金记录不存在');
        }
      }
      for (const row of edit.changes.holdings) {
        if (row.id === null) {
          await db.execute(`INSERT INTO case_generated_holdings
            (workspace_id,chat_id,case_id,account_id,fund_code,share_class,total_volume)
            VALUES (?,?,?,?,?,?,?)`, [...keys,row.accountId,row.fundCode,row.shareClass,row.totalVolume]);
        } else {
          const [result] = await db.execute(`UPDATE case_generated_holdings SET total_volume=?
            WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=?
              AND account_id=? AND fund_code=? AND share_class=?`,
          [row.totalVolume,...keys,row.id,row.accountId,row.fundCode,row.shareClass]);
          if (!result.affectedRows) throw storeError('DATA_ROW_NOT_FOUND', 404, '持有记录不存在');
        }
      }
      const changed = Object.values(edit.changes).some(rows => rows.length);
      const afterRevision = edit.revision + Number(changed);
      if (changed) await db.execute(`INSERT INTO case_data_edit_events
        (workspace_id,chat_id,case_id,revision,edit_json) VALUES (?,?,?,?,?)`,
      [...keys,afterRevision,JSON.stringify(edit.changes)]);
      if (reviewTurn) {
        const [[lastTurn]] = await db.execute(`SELECT COALESCE(MAX(turn_number),0) AS number
          FROM case_data_review_turns WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
        await db.execute(`INSERT INTO case_data_review_turns
          (workspace_id,chat_id,case_id,turn_number,before_revision,after_revision,
           user_text,assistant_text,changes_json) VALUES (?,?,?,?,?,?,?,?,?)`,
        [...keys,Number(lastTurn.number)+1,edit.revision,afterRevision,
          reviewTurn.userInput,reviewTurn.reply,JSON.stringify(edit.changes)]);
      }
      return readGeneratedData(db, keys);
    });
  }

  async function dataReviewTurns(token, chatPublicId, casePublicId) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[scope]] = await db.execute(`SELECT k.id AS case_id,k.chat_id
        FROM cases k JOIN case_chats h ON h.workspace_id=k.workspace_id AND h.id=k.chat_id
        WHERE k.workspace_id=? AND h.public_id=? AND k.public_id=?`,
      [auth.workspace_id,chatPublicId,casePublicId]);
      if (!scope) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      const [turns] = await db.execute(`SELECT turn_number,before_revision,after_revision,
        user_text,assistant_text,created_at FROM case_data_review_turns
        WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY turn_number`,
      [auth.workspace_id,scope.chat_id,scope.case_id]);
      return { turns: turns.map(turn => ({ number: turn.turn_number,
        beforeRevision: turn.before_revision, afterRevision: turn.after_revision,
        userInput: turn.user_text, reply: turn.assistant_text, createdAt: turn.created_at })) };
    });
  }

  async function confirmGeneratedData(token, chatPublicId, casePublicId, revision) {
    chatPublicId = requiredUuid(chatPublicId, 'Chat');
    casePublicId = requiredUuid(casePublicId, 'Case');
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw storeError('INVALID_REVISION', 400, '数据版本无效');
    }
    return transaction(async db => {
      const auth = await authenticateSession(db, token);
      const [[chat]] = await db.execute(`SELECT id,status FROM case_chats
        WHERE workspace_id=? AND public_id=? FOR UPDATE`, [auth.workspace_id,chatPublicId]);
      if (!chat) throw storeError('CHAT_NOT_FOUND', 404, 'Chat 不存在');
      if (chat.status !== 'ACTIVE') throw storeError('CHAT_CLOSED', 409, 'Chat 已结束');
      const [[caseRow]] = await db.execute(`SELECT id,status FROM cases
        WHERE workspace_id=? AND chat_id=? AND public_id=? FOR UPDATE`,
      [auth.workspace_id,chat.id,casePublicId]);
      if (!caseRow) throw storeError('CASE_NOT_FOUND', 404, 'Case 不存在');
      if (!['SOP_LOCKED','EXECUTING'].includes(caseRow.status)) {
        throw storeError('INVALID_CASE_STATE', 409, '当前 Case 不能确认数据');
      }
      const keys = [auth.workspace_id,chat.id,caseRow.id];
      const [[execution]] = await db.execute(`SELECT sop_version_id FROM case_data_executions
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (!execution) throw storeError('DATA_NOT_STARTED', 409, '数据尚未生成');
      const [[prior]] = await db.execute(`SELECT revision FROM case_data_confirmations
        WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (prior) throw storeError('DATA_ALREADY_CONFIRMED', 409, '数据已经确认');
      const [[latest]] = await db.execute(`SELECT COALESCE(MAX(revision),0) AS revision
        FROM case_data_edit_events WHERE workspace_id=? AND chat_id=? AND case_id=? FOR UPDATE`, keys);
      if (Number(latest.revision) !== revision) {
        throw storeError('DATA_EDIT_CONFLICT', 409, '数据已更新，请先查看最新版本');
      }
      await db.execute(`INSERT INTO case_data_confirmations
        (workspace_id,chat_id,case_id,revision,actor_user_id) VALUES (?,?,?,?,?)`,
      [...keys,revision,auth.user_id]);
      if (caseRow.status !== 'EXECUTING') {
        await db.execute(`UPDATE cases SET status='EXECUTING'
          WHERE workspace_id=? AND chat_id=? AND id=?`, keys);
        await db.execute(`INSERT INTO case_state_events
          (workspace_id,chat_id,case_id,from_status,to_status,actor_user_id,reason)
          VALUES (?,?,?,?,?,?,'USER_CONFIRMED_DATA')`,
        [...keys,caseRow.status,'EXECUTING',auth.user_id]);
      }
      return readGeneratedData(db, keys);
    });
  }

  return Object.freeze({ createChat, listChats, assertCaseWritable, createCase, listCases, saveSopProposal,
    getLatestSopProposal, confirmSopProposal, readCaseDiscussion, beginCaseDiscussionTurn,
    finishCaseDiscussionTurn, abandonCaseDiscussionTurn, finishCasePlanProposal,
    generatedData, generatedDataCatalog, executeGeneratedData, editGeneratedData,
    dataReviewTurns, confirmGeneratedData });
}
