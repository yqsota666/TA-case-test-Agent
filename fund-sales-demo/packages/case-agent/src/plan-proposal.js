import { z } from 'zod';

export const PLAN_PROPOSAL_PROMPT_VERSION = 'plan-proposal-v1';
export const PLAN_PROPOSAL_PROMPT = '你是测试方案讨论助手。根据完整对话生成一份供使用者审阅的 Plan 提案。已确认的信息按原意使用；preconditions 是提案需要准备的条件，尚未确认的条件还要列入 openQuestions，不要编造现有事实。提案要有可观察的预期和证据，但不能宣称已获用户确认、锁定 SOP 或执行任何操作。只输出一个 JSON 对象，不加 Markdown 或解释，字段固定为：{"objective":"测试目标","preconditions":["需要准备的条件"],"scenarios":[{"title":"场景名称","setup":"准备条件","action":"测试动作","expected":"预期观察","evidence":"需要的证据"}],"openQuestions":["待用户确认的问题"]}。preconditions 和 openQuestions 可以为空数组；scenarios 至少一项。每个字符串字段都用单行纯文本，不含换行或 Markdown 标记。字段内容根据当前对话生成，不照抄上述示例文字。';

const Nonempty = z.string().min(1).max(1000).refine(value =>
  value.trim() === value && !/[\r\n]|\*\*|__|`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\n]+\)|^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(value));
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
}).strict();

export function parsePlanProposal(reply) {
  if (typeof reply !== 'string' || reply.length > 100000) {
    const error = new Error('Plan 提案必须是 JSON 对象');
    error.code = 'MODEL_OUTPUT_FORMAT';
    throw error;
  }
  try {
    const parsed = PlanProposalSchema.safeParse(JSON.parse(reply));
    if (parsed.success) return parsed.data;
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
  lines.push('请确认：这份提案是否符合你想测试的内容？有修改请直接指出。');
  return lines.join('\n');
}
