import { hasLiteralExpectation } from '../../platform-protocol/src/numeric-expectations.js';
import { z } from 'zod';
import { validPlanContract } from '../../platform-protocol/src/plan-contract.js';
import { validExchangePlan } from '../../platform-protocol/src/exchange-plan.js';

export const PLAN_PROPOSAL_PROMPT_VERSION = 'plan-proposal-v4';
export const PLAN_PROPOSAL_PROMPT = '新增约束：READY时exchangePlan.openQuestions必须为空数组；仅UNPLANNED时有文件时序待澄清问题。所有openQuestions只列业务参数确实缺失的问题，不把最终按钮确认、整体Plan审阅或已明确事项再次确认列为缺失信息。准备数据和结果预期的两次用户确认由服务端独立处理，你不要代替它们设置待澄清问题。不要增加用户没有要求的结果预期，例如用户只提供模拟余额，不表示要验证余额扣减。现有事实、假设和预期严格按用户已讨论范围。 当用户已明确期望开户或申购等TA业务成功确认时，scenario.expected规范写为“状态为CONFIRMED（成功确认）”；用户已明确期望TA业务失败或拒绝时写“状态为FAILED（业务失败）”。这只规范已讨论预期的表达，不改变业务含义、不猜测成功或失败，也不把Case测试通过/失败等同于TA业务状态。未知业务结果仍列openQuestions并在后续contract.missing澄清；不新增用户未要求的核验项。 你是测试方案讨论助手。根据完整对话生成一份供使用者审阅的 Plan 提案。已确认的信息按原意使用；preconditions 是提案需要准备的条件，尚未确认的条件还要列入 openQuestions，不要编造现有事实。提案要有可观察的预期和证据，但不能宣称已获用户确认、锁定 SOP 或执行任何操作。必须规划文件交换时序，不按文件编号强制排序。新增exchangePlan字段，格式为{status:READY或UNPLANNED,steps:[{stepId:唯一英文标识,roundId:对应申请轮次标识,direction:SEND或RECEIVE,fileType:01或02或03或04或05,businessTime:{kind:DATE或RELATIVE,value:YYYYMMDD或用户确认的相对业务时点说明},required:布尔值,dependsOn:[{stepId:前置步骤标识,condition:SENT或PARSED或CONFIRMED}]}],openQuestions:[待确认问题]}。SEND仅01和03，RECEIVE仅02和04和05。每个02/04必须依赖同轮次01/03的SENT；新开户后03依赖02的CONFIRMED。已有确认账户可直接03；05可以独立且可选。常见1至2轮不是硬上限。不得猜测日期或时间：未讨论清楚则status为UNPLANNED、steps为空且列出具体问题；只有用户对话已明确所有必要时间和顺序才输出READY。依赖不能成环。只输出一个 JSON 对象，不加 Markdown 或解释，原有字段及新增exchangePlan均必填，原有字段格式为：{"objective":"测试目标","preconditions":["需要准备的条件"],"scenarios":[{"title":"场景名称","setup":"准备条件","action":"测试动作","expected":"预期观察","evidence":"需要的证据"}],"openQuestions":["待用户确认的问题"]}。preconditions 和 openQuestions 可以为空数组；scenarios 至少一项。每个字符串字段都用单行纯文本，不含换行或 Markdown 标记。字段内容根据当前对话生成，不照抄上述示例文字。';

const Nonempty = z.string().min(1).max(1000).refine(value =>
  value.trim() === value && !/[\r\n]|\*\*|__|`|\*[^*\n]+\*|(?<![A-Za-z0-9_])_[^_\n]+_(?![A-Za-z0-9_])|\[[^\]\n]+\]\([^)\n]+\)|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(value));
export const PlanProposalSchema = z.object({
  objective: Nonempty,
  preconditions: z.array(Nonempty).max(50),
  scenarios: z.array(z.object({
    title: Nonempty,
    setup: Nonempty,
    action: Nonempty,
    expected: Nonempty,
    evidence: Nonempty,
  }).strict()).min(1).max(100),
  openQuestions: z.array(Nonempty).max(50),
  exchangePlan: z.custom(validExchangePlan),
  contract: z.unknown().optional(),
}).strict().refine(p=>p.contract===undefined || validPlanContract(p.contract,p));

function normalizeUnconfirmedStatusExpectations(proposal) {
  if(proposal.contract!==undefined)return proposal;
  const questions=[...proposal.openQuestions];
  const scenarios=proposal.scenarios.map((scenario,index)=>{
    const expected=scenario.expected.split(/([；;，,。])/).map(clause=>{
      const match=clause.match(/^(\s*)(开户|申购)(成功|失败)(\s*)$/);
      if(match){
        const status=match[3]==='成功'?'CONFIRMED':'FAILED';
        return `${match[1]}${match[2]}申请状态为${status}（${match[3]==='成功'?'成功确认':'业务失败'}）${match[4]}`;
      }
      const status=clause.match(/CONFIRMED|FAILED/)?.[0];
      if(((/(?:开户|申购)/.test(clause) && /(?:成功|失败)/.test(clause)) || status) &&
         !(status && hasLiteralExpectation(status,clause,'status')) && questions.length<50){
        const question=`请澄清场景${index+1}的TA业务确认结果：${clause.trim()}`;
        if(!questions.includes(question))questions.push(question);
      }
      return clause;
    }).join('');
    return {...scenario,expected};
  });
  return {...proposal,scenarios,openQuestions:questions};
}

export function parsePlanProposal(reply) {
  if (typeof reply !== 'string' || reply.length > 100000) {
    const error = new Error('Plan 提案必须是 JSON 对象');
    error.code = 'MODEL_OUTPUT_FORMAT';
    throw error;
  }
  try {
    const parsed = PlanProposalSchema.safeParse(JSON.parse(reply));
    if (parsed.success && parsed.data.exchangePlan) {
      const normalized=PlanProposalSchema.safeParse(normalizeUnconfirmedStatusExpectations(parsed.data));
      if(normalized.success)return normalized.data;
    }
  } catch { /* Invalid JSON is reported below. */ }
  const error = new Error('Plan 提案缺少必填字段或不是有效 JSON');
  error.code = 'MODEL_OUTPUT_FORMAT';
  throw error;
}

export function displayPlanProposal(proposal) {
  const lines = [`测试目标：${proposal.objective}`];
  for (const [index, condition] of proposal.preconditions.entries()) {
    lines.push(`准备条件 ${index + 1}：${condition}`);
  }
  for (const [index, scenario] of proposal.scenarios.entries()) {
    lines.push(`场景 ${index + 1}：${scenario.title}`,
      `准备：${scenario.setup}`, `动作：${scenario.action}`,
      `预期：${scenario.expected}`, `证据：${scenario.evidence}`);
  }
  for (const [index, question] of proposal.openQuestions.entries()) {
    lines.push(`待确认 ${index + 1}：${question}`);
  }
  if (proposal.exchangePlan) {
    for (const s of proposal.exchangePlan.steps) lines.push(`文件步骤 ${s.stepId}：${s.direction} ${s.fileType}；${s.businessTime.value}；前置 ${s.dependsOn.map(d => `${d.stepId}/${d.condition}`).join('、') || '无'}；${s.required ? '必需' : '可选'}`);
    for (const q of proposal.exchangePlan.openQuestions) lines.push(`时序待确认：${q}`);
  }
  lines.push('请确认：这份提案是否符合你想测试的内容？有修改请直接指出。');
  return lines.join('\n');
}

function mentionsTime(clause, time) {
  if (time.kind === 'DATE') {
    return [...clause.matchAll(/(?<![A-Za-z0-9_])(\d{4})(?:[-/年](\d{1,2})[-/月](\d{1,2})日?|(\d{2})(\d{2}))(?![A-Za-z0-9_])/g)]
      .some(match => match[1] + (match[2] ?? match[4]).padStart(2, '0') +
        (match[3] ?? match[5]).padStart(2, '0') === time.value);
  }
  let index = clause.indexOf(time.value);
  while (index !== -1) {
    const before = clause[index - 1] ?? '';
    const after = clause[index + time.value.length] ?? '';
    if ((!/^[A-Za-z0-9_]/.test(time.value) || !/[A-Za-z0-9_]/.test(before)) &&
        (!/[A-Za-z0-9_]$/.test(time.value) || !/[A-Za-z0-9_]/.test(after))) return true;
    index = clause.indexOf(time.value, index + 1);
  }
  return false;
}

function rejectsTime(clause) {
  return /不|没|未|否|勿|除|无需|无须|拒绝|禁止|避免|取消|放弃|停用|停止|撤销|作废|暂缓|另定|再定|再说|重排|别用|举例|例如|比如|假设|示例|仅供参考|只是|可能|也许|提到|看到|听说|说过|引用|单号|编号|文件名|日志|候选|待定|待确认|考虑|如果|还是|术语|含义|概念|格式|表达|[？?]|\b(?:not|no|never|don't|dont|won't|example|maybe)\b/i.test(clause);
}

const allFiles = /所有文件|全部文件|每个文件|每份文件|所有步骤|全部步骤/;
const sendTimeRole = /业务日期|申请日期|发送|生成|申请时间|申请时点/;
const receiveTimeRole = /回传|回报|接收|上传|确认日期|确认时间|确认时点/;
const timeRevision = /改为|改成|更改|变成|换成|调整|改到|换到|挪到|改用|换用|改至|挪至|调至|延期|推迟|提前|延后/;

function timingScope(clause, step) {
  // Timing numbers and round ordinals are not file references.
  const withoutTimes = clause
    .replace(/(?<![A-Za-z0-9_])\d{4}(?:[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{4})(?![A-Za-z0-9_])/g, ' ')
    .replace(/T\s*[+\-＋－−]\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/第\s*\d+\s*(?:轮|次|天|日)|\d+\s*(?:个)?(?:交易日|工作日|自然日|小时|分钟|秒|天|日(?!期)|周(?![一二三四五六日天1-7])|月|年)/g, ' ');
  const files = [...withoutTimes.matchAll(/(?<![A-Za-z0-9_])(01|02|03|04|05)(?![A-Za-z0-9_])/g)].map(match => match[1]);
  if (files.length) return { addressed: files.includes(step.fileType), global: false };
  if (allFiles.test(clause)) return { addressed: true, global: false };
  const send = sendTimeRole.test(clause), receive = receiveTimeRole.test(clause);
  return { addressed: step.direction === 'SEND' ? send : receive, global: !send && !receive };
}

function affirmsTime(clause) {
  // This is deliberately conservative: a mention, question or rejected time needs discussion.
  if (rejectsTime(clause)) return false;
  return /日期|业务日|时间|时点|发送|接收|上传|生成|确认|采用|使用|就用|用|定为|设为|安排|选择|改成|改为|当天|\b(?:date|time|send|receive|use)\b/i.test(clause) ||
    allFiles.test(clause) || /^\s*(?:01|02|03|04|05)(?![A-Za-z0-9_])(?:文件)?\s*[:：]?\s*/.test(clause);
}

// Only human timing statements count; later rejection replaces earlier affirmative evidence.
export function guardExchangeTimeEvidence(proposal, userMessages) {
  if (proposal.exchangePlan.status !== 'READY') return proposal;
  const clauses = userMessages.flatMap(message => message.match(/[^。！？?!；;\n，,]+[。！？?!；;\n，,]?/g) ?? []);
  const missing = proposal.exchangePlan.steps.filter(step => {
    const latest = clauses.findLast(clause => {
      const scope = timingScope(clause, step), mentioned = mentionsTime(clause, step.businessTime);
      return (scope.addressed && (mentioned || timeRevision.test(clause) || /日期|时间|时点|改期|取消|放弃|停用|停止|撤销|作废|拒绝|不使用|不用|不要|不再|别用|待定|待确认|候选|考虑|暂缓|另定|再定|再说|重排|T(?:日|[+-]\d)|当天|次日|今天|明天|后天|上午|下午|晚上|早上|中午|本周|下周|月底|月初|(?:周|星期|礼拜)[一二三四五六日天1-7]|\d{4}(?:[-/年]|\d{4})/.test(clause))) ||
        (scope.global && mentioned && rejectsTime(clause));
    });
    const revisedTime = latest?.split(timeRevision).at(-1);
    return !latest || !timingScope(latest, step).addressed || !mentionsTime(revisedTime, step.businessTime) || !affirmsTime(latest);
  });
  if (!missing.length) return proposal;
  return { ...proposal, exchangePlan: { status: 'UNPLANNED', steps: [],
    openQuestions: missing.slice(0,30).map(step => `请确认 ${step.stepId}（${step.fileType}）的业务日期或相对业务时点，不使用模型推测的时间。`) } };
}
