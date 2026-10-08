import {consolidateExchangePlan} from '../../platform-protocol/src/consolidate-exchange-plan.js';
import { hasLiteralExpectation } from '../../platform-protocol/src/numeric-expectations.js';
import { z } from 'zod';
import { validPlanContract } from '../../platform-protocol/src/plan-contract.js';
import { validExchangePlan } from '../../platform-protocol/src/exchange-plan.js';

export const PLAN_PROPOSAL_PROMPT_VERSION = 'plan-proposal-v8';
export const PLAN_PROPOSAL_PROMPT = '人工文件交换约束：同一项目可合并的记录按文件类型、业务日期与依赖一次批量规划，不按客户或场景重复列发送/接收步骤。多条申请可引用同一个SEND步骤，01覆盖全部新账户，03覆盖相应账户基金。对比构造只改变目标变量，其他可控条件保持一致；同日发文、同通道可合批时合批，不为每个客户增加TA人工往返。不同业务日期或真实依赖不能虚假合并，不擅改已明确业务条件；如果可用不同观察时点完成对比，应作为待用户审阅的方案条件写明。文件规划优先约束：本平台主要通过TA文件构造测试条件。需要新增模拟客户及账户时必须规划01开户申请和02回传；需要在这些账户中构造基金份额或申购数据时必须规划03申购申请和04回传，新账户03依赖02成功确认。准备表中的预置账户或持仓不证明已获TA确认，不能据此取消文件交换。已有正式确认账户可复用并省略01，但必须基于真实正式数据引用，不能把新模拟账户冒充已有账户。05按核对持仓的实际需要决定，不一律添加。只有不构造账户/交易、明确复用既有正式资源的只读或计算测试才能NOT_REQUIRED。若用户指令与这些构造约束矛盾，应指出冲突并重新规划，不盲从取消文件。业务参数由AI和用户讨论，文件格式由系统校验。READY时exchangePlan.openQuestions必须为空数组；仅UNPLANNED时有文件时序待澄清问题。所有openQuestions只列业务参数确实缺失的问题，不把最终按钮确认、整体Plan审阅或已明确事项再次确认列为缺失信息。准备数据和结果预期的两次用户确认由服务端独立处理，你不要代替它们设置待澄清问题。不要增加用户没有要求的结果预期，例如用户只提供模拟余额，不表示要验证余额扣减。现有事实、假设和预期严格按用户已讨论范围，完整覆盖用户已要求的每项业务状态和数值预期，不遗漏、不新增核验项。用户明确要求的开户/申购确认状态、确认金额、确认份额属于结果预期，必须保留在对应scenario.expected，不能只放setup或preconditions；业务计算预期与协议确认预期可以同时保留。 当用户已明确期望开户或申购等TA业务成功确认时，scenario.expected规范写为“状态为CONFIRMED（成功确认）”；用户已明确期望TA业务失败或拒绝时写“状态为FAILED（业务失败）”。这只规范已讨论预期的表达，不改变业务含义、不猜测成功或失败，也不把Case测试通过/失败等同于TA业务状态。未知业务结果仍列openQuestions并在后续contract.missing澄清；不新增用户未要求的核验项。 你是测试方案讨论助手。根据完整对话生成一份供使用者审阅的 Plan 提案。已确认的信息按原意使用；preconditions 是提案需要准备的条件，待生成的模拟条件直接构造为供审阅的准备提案，不因它们尚未人工确认就列入openQuestions；用户允许合成规则时明确标记为模拟假设。只有无法确定且影响测试结果的业务规则才询问，不要求用户提供系统索引或协议状态，不把预期当已发生事实。提案要有可观察的预期和证据，但不能宣称已获用户确认、锁定 SOP 或执行任何操作。必须规划文件交换时序，不按文件编号强制排序。新增exchangePlan字段，格式为{status:READY或UNPLANNED或NOT_REQUIRED,steps:[{stepId:唯一英文标识,roundId:对应申请轮次标识,direction:SEND或RECEIVE,fileType:01或02或03或04或05,businessTime:{kind:DATE或RELATIVE,value:YYYYMMDD或用户确认的相对业务时点说明},required:布尔值,dependsOn:[{stepId:前置步骤标识,condition:SENT或PARSED或CONFIRMED}]}],openQuestions:[待确认问题]}。SEND仅01和03，RECEIVE仅02和04和05。每个02/04必须依赖同轮次01/03的SENT；新开户后03依赖02的CONFIRMED。已有确认账户可直接03；05可以独立且可选。常见1至2轮不是硬上限。不得猜测日期或时间：未讨论清楚则status为UNPLANNED、steps为空且列出具体问题；只有用户对话已明确所有必要时间和顺序才输出READY。依赖不能成环。只输出一个 JSON 对象，不加 Markdown 或解释，原有字段及新增exchangePlan均必填，原有字段格式为：{"objective":"测试目标","preconditions":["需要准备的条件"],"scenarios":[{"title":"场景名称","setup":"准备条件","action":"测试动作","expected":"预期观察","evidence":"需要的证据"}],"openQuestions":["待用户确认的问题"]}。preconditions 和 openQuestions 可以为空数组；scenarios 至少一项。每个字符串字段都用单行纯文本，不含换行或 Markdown 标记。字段内容根据当前对话生成，不照抄上述示例文字。';

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
      const match=clause.match(/^(\s*(?:(?:预期|期望|应当|应|(?:02|04)(?:文件)?(?:解析结果为|解析为|结果为|为)?|解析结果为|解析为|结果为)\s*)*)(开户|申购)(成功|失败)(\s*)$/);
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
      if(normalized.success){
        if(normalized.data.contract)return normalized.data;
        return {...normalized.data,exchangePlan:consolidateExchangePlan(normalized.data.exchangePlan)};
      }
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
const sendTimeRole = /业务日期|申请日期|发送|发(?=\s*(?:01|03))|生成|申请时间|申请时点/;
const receiveTimeRole = /回传|回报|接收|收到|上传|确认日期|确认时间|确认时点/;
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
  return /日期|业务日|时间|时点|发送|发(?=\s*(?:01|03))|接收|收到|上传|生成|确认|采用|使用|就用|用|定为|设为|安排|选择|改成|改为|当天|\b(?:date|time|send|receive|use)\b/i.test(clause) ||
    allFiles.test(clause) || /^\s*(?:01|02|03|04|05)(?![A-Za-z0-9_])(?:文件)?\s*[:：]?\s*/.test(clause);
}

// Resolve a same-day or year-elided date only inside one human message.
// Negative/quoted dates never establish the context for another step.
function expandHumanTimingClauses(message) {
  let date;
  return (message.match(/[^。！？?!；;\n，,]+[。！？?!；;\n，,]?/g) ?? []).map(clause => {
    const full=clause.match(/(?<![A-Za-z0-9_])(\d{4})(?:[-/年](\d{1,2})[-/月](\d{1,2})日?|(\d{2})(\d{2}))(?![A-Za-z0-9_])/);
    if(full && !rejectsTime(clause) && affirmsTime(clause)) date=full[1]+(full[2]??full[4]).padStart(2,'0')+(full[3]??full[5]).padStart(2,'0');
    else if(date && !rejectsTime(clause) && affirmsTime(clause)) {
      const short=clause.match(/(?<![\d年])(\d{1,2})月(\d{1,2})日/);
      if(short) {date=date.slice(0,4)+short[1].padStart(2,'0')+short[2].padStart(2,'0');clause=clause.replace(short[0],date);}
      else if(/当天|同日/.test(clause)) clause=clause.replace(/当天|同日/g,` ${date} `);
    }
    return clause;
  });
}

// Only human timing statements count; later rejection replaces earlier affirmative evidence.
export function guardExchangeTimeEvidence(proposal, userMessages) {
  if (proposal.exchangePlan.status !== 'READY') return proposal;
  const messages = userMessages.map(expandHumanTimingClauses);
  const missing = proposal.exchangePlan.steps.filter(step => {
    const relevant = clause => {
      const scope=timingScope(clause,step),mentioned=mentionsTime(clause,step.businessTime);
      // Batching instructions reject redundant rounds, not the agreed dates.
      if(/拆分|拆成|分批|合批|合并|重复列|按客户|按场景/.test(clause) && !mentioned && !/日期|业务日|时间|时点|改期|T\s*[+-]|明天|后天|次日/.test(clause))return false;
      if(step.businessTime.kind==='DATE' && /\d{1,2}:\d{2}(?::\d{2})?/.test(clause) && !mentioned && !/日期|业务日|改期/.test(clause) && !timeRevision.test(clause))return false;
      return (scope.addressed && (mentioned || timeRevision.test(clause) || /日期|时间|时点|改期|取消|放弃|停用|停止|撤销|作废|拒绝|不使用|不用|不要|不再|别用|待定|待确认|候选|考虑|暂缓|另定|再定|再说|重排|T(?:日|[+-]\d)|当天|同日|次日|今天|明天|后天|上午|下午|晚上|早上|中午|本周|下周|月底|月初|(?:周|星期|礼拜)[一二三四五六日天1-7]|\d{4}(?:[-/年]|\d{4})/.test(clause))) || (scope.global && mentioned && rejectsTime(clause));
    };
    const latestMessage=messages.findLast(clauses=>clauses.some(relevant));
    if(!latestMessage)return true;
    const clauses=latestMessage.filter(relevant);
    // A later human message replaces earlier timing. Within one message,
    // independent rounds may affirm several dates for the same file type.
    const last=clauses.findLast(clause=>mentionsTime(clause,step.businessTime)||rejectsTime(clause)||timeRevision.test(clause));
    if(last && (rejectsTime(last) || timeRevision.test(last))) {
      return !timingScope(last,step).addressed || !mentionsTime(last.split(timeRevision).at(-1),step.businessTime) || !affirmsTime(last);
    }
    return !clauses.some(clause=>timingScope(clause,step).addressed && mentionsTime(clause,step.businessTime) && affirmsTime(clause));
  });
  if (!missing.length) return proposal;
  return { ...proposal, exchangePlan: { status: 'UNPLANNED', steps: [],
    openQuestions: missing.slice(0,30).map(step => `请确认 ${step.fileType} 文件的业务日期或相对业务时点，不使用模型推测的时间。`) } };
}
