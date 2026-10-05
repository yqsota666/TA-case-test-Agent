import { z } from 'zod';
import { DataEditSchema } from './data-generation.js';

const ReviewReplySchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  changes: DataEditSchema.shape.changes,
}).strict();

export const DATA_REVIEW_PROMPT = `你正在与用户核对当前 Case 的模拟数据。输入包含已确认的 Plan、最新四张表和用户本轮意见。只根据当前 Case 的内容回答；不能读取或修改其他 Case。你可以回答问题，也可以提出一组对现有数据的修改。不要自行确认数据，不要生成 01/03 文件或声称 TA 已确认。

只输出 JSON 对象，恰好有 reply 和 changes 两个字段。reply 用简短中文说明本轮将改哪些模拟记录；如果信息不足，明确问一个具体问题。changes 必须有 customers、accounts、funds、holdings 四个数组；没有要改的表填空数组。不要输出 Markdown。

可修改的字段与格式：
- customers：每项 {id,name,investorType,simulatedBalance}。修改已有客户时 id 用当前表中的 ID 字符串，不要带 branchCode；新增时 id 为 null，另加 branchCode 作为新账户的网点。investorType 仅 "0" 机构或 "1" 个人；simulatedBalance 是两位小数字符串。
- accounts：每项 {id,customerId,branchCode}。新增账户的 id 为 null，customerId 必须是当前客户表中的 ID；修改已有账户时 id 和 customerId 均为当前表中的字符串，只能调整 branchCode。交易账号由系统生成，不可修改。
- funds：每项 {id,fundCode,fundName,shareClass,nav}。新增时 id 为 null；修改时使用当前 ID，保持基金代码和份额类别不变。fundCode 六位数字，shareClass 单个大写字母或数字，nav 八位小数字符串。
- holdings：每项 {id,accountId,fundCode,shareClass,totalVolume}。新增时 id 为 null；修改时 id 是当前表中的 ID。accountId 必须引用当前账户，fundCode 与 shareClass 必须引用当前基金，totalVolume 是八位小数字符串。

现阶段不支持删除记录、改变已有基金的代码/份额类别、重新分配账户或改动数据库 ID。用户提出这些要求时，不要伪装成功；用 reply 说明当前不能自动完成，changes 留空。不要把模型回复中的说明当成已确认事实。Plan 是初版数据的依据；用户在本轮明确要求的数据修订优先于初版值，但不能据此篡改 Plan 或测试目标。`;

export function parseDataReviewReply(text) {
  let json;
  try { json = JSON.parse(text); } catch { /* Report a stable error below. */ }
  const parsed = ReviewReplySchema.safeParse(json);
  if (!parsed.success) throw Object.assign(new Error('模型返回的数据修改建议格式无效'),
    { code: 'DATA_REVIEW_INVALID', status: 422 });
  return parsed.data;
}

export async function deriveDataReview(complete, { plan, data, turns, userInput }) {
  const reply = await complete({ system: DATA_REVIEW_PROMPT,
    user: JSON.stringify({ plan, data: {
      customers: data.customers, accounts: data.accounts,
      funds: data.funds, holdings: data.holdings,
    }, priorTurns: turns, userInput }) });
  return parseDataReviewReply(reply);
}
