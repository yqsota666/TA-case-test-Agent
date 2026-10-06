import crypto from 'node:crypto';
import { StateGraph, StateSchema, START, END } from '@langchain/langgraph';
import { z } from 'zod';

const decimal = (integerDigits, fractionalDigits) => z.string()
  .regex(new RegExp(`^\\d{1,${integerDigits}}\\.\\d{${fractionalDigits}}$`))
  .transform(value => value.replace(/^0+(?=\d+\.)/, ''));
const Money = decimal(14, 2);
const Nav = decimal(8, 8);
const Volume = decimal(10, 8);
const Id = z.string().regex(/^\d{1,20}$/);
const Branch = z.string().regex(/^\d{1,9}$/);
const FundCode = z.string().regex(/^\d{6}$/);
const ShareClass = z.string().regex(/^[A-Z0-9]$/);

export const DataEditSchema = z.object({
  revision: z.number().int().nonnegative(),
  changes: z.object({
    customers: z.array(z.object({ id: Id.nullable(), name: z.string().trim().min(1).max(180),
      investorType: z.enum(['0', '1']), simulatedBalance: Money,
      branchCode: Branch.optional() }).strict().superRefine((row, ctx) => {
      if (row.id === null && !row.branchCode) ctx.addIssue({ code: 'custom',
        path: ['branchCode'], message: '新客户需要分支代码' });
      if (row.id !== null && row.branchCode !== undefined) ctx.addIssue({ code: 'custom',
        path: ['branchCode'], message: '已有客户的分支代码须通过账户修改' });
    })).max(50),
    accounts: z.array(z.object({ id: Id.nullable(), customerId: Id, branchCode: Branch }).strict()).max(100),
    funds: z.array(z.object({ id: Id.nullable(), fundCode: FundCode,
      fundName: z.string().trim().min(1).max(200), shareClass: ShareClass, nav: Nav,
    }).strict()).max(50),
    holdings: z.array(z.object({ id: Id.nullable(), accountId: Id,
      fundCode: FundCode, shareClass: ShareClass, totalVolume: Volume,
    }).strict()).max(200),
  }).strict(),
}).strict();
export const DataSpecificationSchema = z.object({
  customers: z.array(z.object({
    name: z.string().min(1).max(180),
    investorType: z.union([z.enum(['0', '1']), z.literal(0), z.literal(1)]).transform(String),
    simulatedBalance: Money,
  }).strict()).max(50),
  accounts: z.array(z.object({
    customerIndex: z.number().int().nonnegative(),
    branchCode: z.union([Branch,
      z.number().int().nonnegative().max(999999999)]).transform(String),
  }).strict()).max(100),
  funds: z.array(z.object({
    fundCode: FundCode, fundName: z.string().min(1).max(200),
    shareClass: ShareClass, nav: Nav,
  }).strict()).max(50),
  holdings: z.array(z.object({
    accountIndex: z.number().int().nonnegative(), fundIndex: z.number().int().nonnegative(),
    totalVolume: Volume,
  }).strict()).max(200).default([]),
  missing: z.array(z.string().min(1).max(200)).max(30),
}).strict().superRefine((value, ctx) => {
  for (const [index, account] of value.accounts.entries()) {
    if (account.customerIndex >= value.customers.length) ctx.addIssue({
      code: 'custom', path: ['accounts', index, 'customerIndex'], message: '客户引用不存在',
    });
  }
  const funds = new Set();
  for (const [index, fund] of value.funds.entries()) {
    const key = `${fund.fundCode}:${fund.shareClass}`;
    if (funds.has(key)) ctx.addIssue({ code: 'custom', path: ['funds', index], message: '基金重复' });
    funds.add(key);
  }
  const holdings = new Set();
  for (const [index, holding] of value.holdings.entries()) {
    if (holding.accountIndex >= value.accounts.length || holding.fundIndex >= value.funds.length) {
      ctx.addIssue({ code: 'custom', path: ['holdings', index], message: '持有记录引用不存在' });
    }
    const key = `${holding.accountIndex}:${holding.fundIndex}`;
    if (holdings.has(key)) ctx.addIssue({ code: 'custom', path: ['holdings', index], message: '持有记录重复' });
    holdings.add(key);
  }
});

const DATA_GENERATION_RULES = `你负责把当前 Case 已由用户确认的 Plan 转成模拟数据定义。你只处理本次 Case；不要把其他 Case 的客户、账户、基金或持有记录混进来。Plan 是本次数据的业务来源；下面的字段说明是所有 Case 共用的数据结构，不是某个 Case 的示例值。

这些数组只定义本次需要准备的初始模拟草稿，不是最终正式数据。Plan写出的最终开户、成交金额、总份额、可用份额、冻结份额是02/04/05解析并显式同步后的预期结果，不得倒填为初始模拟客户、账户或持仓。尤其不能把预期最终份额提前准备成初始模拟持仓。
沿用已有正式账户、独立接收05的Case，不为凑齐四张表而新建模拟客户或交易账户；若Plan未明确要求初始模拟持仓，holdings也为空。Plan明确客户、账户、持仓草稿为空时，customers、accounts、holdings三个数组必须保持为空，只保留Plan确实需要的基金元数据。已有正式交易账号、TA账号与通道由后续申请/结果预期的引用选择正式数据，不复制为新模拟账号；不能因accounts为空就列“缺少账户”或生成新账号。真正缺少已确认账户引用时才澄清。
05同步支持正式持仓的totalVolume、availableVolume、frozenVolume；准备草稿schema只含totalVolume并不限制最终05结果核验。可用/冻结的最终预期交给结果断言节点，不在草稿里新增字段，不因为草稿schema没有availableVolume/frozenVolume而列missing。需要澄清的是缺失的初始模拟条件，或确实缺少的明确业务引用，不是未来回传才产生的结果。

逐项理解 Plan 的目标、前提、场景和预期结果，再决定需要多少条记录。Plan 写明的名称、代码、数量、金额和关联关系必须保持原样；Plan 没要求的记录不要为了填满表而添加。可以为 Plan 明确要求但未指定具体值的模拟记录选择合理值，并确保它们能够支持 Plan 的预期结果。若关键业务条件无法合理确定，写入 missing，不要猜测后继续生成。不得声称模拟数据是真实客户、真实持仓或 TA 确认结果。

只输出一个 JSON 对象，顶层恰好包含 customers、accounts、funds、holdings、missing 五个数组。不要输出 Markdown、解释或 SQL。每个记录只能包含下方列出的字段。数组索引从 0 开始；引用必须指向同一份输出中的现有记录。若 Plan 不需要某张表的记录，该数组为空。missing 列出阻止可靠生成的具体问题；没有问题时为空数组。不要创建交易申请、01/03 文件或 TA 回传。`;

const DATA_TABLE_GUIDE = `四张公共数据表及输出字段：
1. customers（客户）：name 是模拟客户名称；investorType 是客户类型，个人写 "1"，机构写 "0"；simulatedBalance 是模拟可用余额，单位元，使用保留两位小数的字符串。一个客户可对应多个交易账户。客户 ID、工作空间 ID、Chat ID、Case ID 由数据库生成或绑定，不要输出。
2. accounts（交易账户）：customerIndex 是该账户归属的 customers 数组索引；branchCode 是开户分支代码，1 到 9 位数字字符串。同一客户需要多个账户时可以有多条记录。交易账号由系统生成，账户 ID 也由系统生成；不要输出 account_no 或编造真实账号。
3. funds（基金）：fundCode 是六位数字基金代码；fundName 是基金名称；shareClass 是一位大写字母或数字，表示份额类别；nav 是单位净值，使用保留八位小数的字符串。同一基金代码可以有不同份额类别，但 fundCode 与 shareClass 的组合不得重复。基金记录只描述产品，不代表客户已经持有。
4. holdings（模拟持有）：accountIndex 是所属 accounts 数组索引；fundIndex 是所持 funds 数组索引；totalVolume 是模拟持有份额，使用保留八位小数的字符串。只有 Plan 明确要求在接收TA回传前准备初始模拟持仓时才生成；正式持仓的最终预期不能作为这里的初始持仓。相同账户和基金份额类别的组合不能重复。这里的持有仅供 Case 测试，不代表 TA 已确认持仓。

所有数字字段须按上述格式输出为字符串。客户、账户、基金、持有之间的引用必须一致；不要输出数据库管理的 ID、时间戳、交易账号或四张表之外的字段。`;

export const DATA_GENERATION_PROMPT = `${DATA_GENERATION_RULES}\n\n${DATA_TABLE_GUIDE}`;

export function parseDataSpecification(reply) {
  let json;
  try { json = JSON.parse(reply); } catch { /* Report a stable error below. */ }
  const parsed = DataSpecificationSchema.safeParse(json);
  if (!parsed.success) throw Object.assign(new Error('模型返回的数据定义无效'),
    { code: 'DATA_SPEC_INVALID', status: 422 });
  if (parsed.data.missing.length) throw Object.assign(
    new Error(`Plan 缺少执行数据：${parsed.data.missing.join('；')}`),
    { code: 'DATA_INPUT_REQUIRED', status: 409, missing: parsed.data.missing });
  if (!parsed.data.customers.length && !parsed.data.funds.length) throw Object.assign(
    new Error('Plan 没有需要生成的客户或基金'), { code: 'DATA_SPEC_EMPTY', status: 409 });
  return parsed.data;
}

export async function deriveDataSpecification(complete, plan) {
  const reply = await complete({ system: DATA_GENERATION_PROMPT,
    user: JSON.stringify(plan) });
  return parseDataSpecification(reply);
}

const DataState = new StateSchema({
  customerIds: z.array(z.string()).default([]),
  accountIds: z.array(z.string()).default([]),
  fundIds: z.array(z.string()).default([]),
  holdingIds: z.array(z.string()).default([]),
  validated: z.boolean().default(false),
});

// Ordered LangGraph nodes. All writes run inside the caller's one database
// transaction, so a failed validation cannot leave partial generated data.
export function createDataGenerationGraph({ db, scope, specification }) {
  const keys = [scope.workspaceId, scope.chatId, scope.caseId];
  const graph = new StateGraph(DataState);
  graph.addNode('customer_define', async () => {
    const ids = [];
    for (const customer of specification.customers) {
      const publicId = crypto.randomUUID();
      const [row] = await db.execute(`INSERT INTO case_generated_customers
        (public_id,workspace_id,chat_id,case_id,name,investor_type,simulated_balance)
        VALUES (?,?,?,?,?,?,?)`, [publicId, ...keys, customer.name,
        customer.investorType, customer.simulatedBalance]);
      ids.push(String(row.insertId));
    }
    return { customerIds: ids };
  });
  graph.addNode('account_define', async ({ customerIds }) => {
    const ids = [];
    for (const account of specification.accounts) {
      const accountNo = `9${Array.from({ length: 16 }, () => crypto.randomInt(10)).join('')}`;
      const [row] = await db.execute(`INSERT INTO case_generated_accounts
        (workspace_id,chat_id,case_id,customer_id,account_no,branch_code)
        VALUES (?,?,?,?,?,?)`, [...keys, customerIds[account.customerIndex],
        accountNo, account.branchCode]);
      ids.push(String(row.insertId));
    }
    return { accountIds: ids };
  });
  graph.addNode('fund_define', async () => {
    const ids = [];
    for (const fund of specification.funds) {
      const [row] = await db.execute(`INSERT INTO case_generated_funds
        (workspace_id,chat_id,case_id,fund_code,fund_name,share_class,nav)
        VALUES (?,?,?,?,?,?,?)`, [...keys, fund.fundCode, fund.fundName,
        fund.shareClass, fund.nav]);
      ids.push(String(row.insertId));
    }
    return { fundIds: ids };
  });
  graph.addNode('holding_define', async ({ accountIds }) => {
    const ids = [];
    for (const holding of specification.holdings) {
      const fund = specification.funds[holding.fundIndex];
      const [row] = await db.execute(`INSERT INTO case_generated_holdings
        (workspace_id,chat_id,case_id,account_id,fund_code,share_class,total_volume)
        VALUES (?,?,?,?,?,?,?)`, [...keys, accountIds[holding.accountIndex],
        fund.fundCode, fund.shareClass, holding.totalVolume]);
      ids.push(String(row.insertId));
    }
    return { holdingIds: ids };
  });
  graph.addNode('data_validate', async ({ customerIds, accountIds, fundIds, holdingIds }) => {
    const [[counts]] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM case_generated_customers WHERE workspace_id=? AND chat_id=? AND case_id=?) AS customers,
      (SELECT COUNT(*) FROM case_generated_accounts WHERE workspace_id=? AND chat_id=? AND case_id=?) AS accounts,
      (SELECT COUNT(*) FROM case_generated_funds WHERE workspace_id=? AND chat_id=? AND case_id=?) AS funds,
      (SELECT COUNT(*) FROM case_generated_holdings WHERE workspace_id=? AND chat_id=? AND case_id=?) AS holdings`,
    [...keys, ...keys, ...keys, ...keys]);
    if (Number(counts.customers) !== customerIds.length ||
        Number(counts.accounts) !== accountIds.length ||
        Number(counts.funds) !== fundIds.length ||
        Number(counts.holdings) !== holdingIds.length) throw new Error('生成数据计数不一致');
    const [[orphans]] = await db.execute(`SELECT COUNT(*) AS count FROM case_generated_accounts a
      LEFT JOIN case_generated_customers c ON c.workspace_id=a.workspace_id
        AND c.chat_id=a.chat_id AND c.case_id=a.case_id AND c.id=a.customer_id
      WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND c.id IS NULL`, keys);
    if (Number(orphans.count)) throw new Error('交易账户与客户关联断裂');
    const [customers] = await db.execute(`SELECT id,name,investor_type,simulated_balance
      FROM case_generated_customers WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [accounts] = await db.execute(`SELECT customer_id,branch_code
      FROM case_generated_accounts WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [funds] = await db.execute(`SELECT fund_code,fund_name,share_class,nav
      FROM case_generated_funds WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    const [holdings] = await db.execute(`SELECT account_id,fund_code,share_class,total_volume
      FROM case_generated_holdings WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY id`, keys);
    for (const [index, actual] of customers.entries()) {
      const expected = specification.customers[index];
      if (actual.name !== expected.name || actual.investor_type !== expected.investorType ||
          String(actual.simulated_balance) !== expected.simulatedBalance) {
        throw new Error('客户字段与已确认 Plan 的数据定义不一致');
      }
    }
    for (const [index, actual] of accounts.entries()) {
      const expected = specification.accounts[index];
      if (String(actual.customer_id) !== customerIds[expected.customerIndex] ||
          actual.branch_code !== expected.branchCode) throw new Error('账户归属或分支代码不一致');
    }
    for (const [index, actual] of funds.entries()) {
      const expected = specification.funds[index];
      if (actual.fund_code !== expected.fundCode || actual.fund_name !== expected.fundName ||
          actual.share_class !== expected.shareClass || String(actual.nav) !== expected.nav) {
        throw new Error('基金字段与已确认 Plan 的数据定义不一致');
      }
    }
    for (const [index, actual] of holdings.entries()) {
      const expected = specification.holdings[index], fund = specification.funds[expected.fundIndex];
      if (String(actual.account_id) !== accountIds[expected.accountIndex] ||
          actual.fund_code !== fund.fundCode || actual.share_class !== fund.shareClass ||
          String(actual.total_volume) !== expected.totalVolume) throw new Error('模拟持有份额不一致');
    }
    return { validated: true };
  });
  graph.addEdge(START, 'customer_define').addEdge('customer_define', 'account_define')
    .addEdge('account_define', 'fund_define').addEdge('fund_define', 'holding_define')
    .addEdge('holding_define', 'data_validate')
    .addEdge('data_validate', END);
  return graph.compile();
}
