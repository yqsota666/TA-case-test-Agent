import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../../../.context/intent-routing/',import.meta.url));
const all=JSON.parse(readFileSync(output+'end-to-end-results.json','utf8'));
if(existsSync(output+'end-to-end-complete-context.json'))all.push(...JSON.parse(readFileSync(output+'end-to-end-complete-context.json','utf8')));
const latest=[...new Map(all.map(r=>[`${r.id}:${r.method}`,r])).values()];
for(const row of latest.filter(r=>r.savedProposal&&r.contractValid&&r.assertionsPassed)){
  const p=row.result.proposal,d=p.contract.dataSpecification;
  const lines=['# '+p.objective,'这是本次真实模型实验生成并通过现有契约校验的审阅稿。仅保存在实验内存和本地证据文件中；准备数据与预期均未人工确认。','## 准备条件',...p.preconditions.map(c=>'- '+c),'## 准备数据',
    ...(d.customers.length?['| 客户 | 类型 | 模拟余额 |','|---|---|---|',...d.customers.map(c=>`| ${c.name} | ${c.investorType==='1'?'个人':'机构'} | ${c.simulatedBalance} |`)]:['无需新建客户。']),
    '',...(d.accounts.length?['| 账户引用 | 所属客户 | 网点 |','|---|---|---|',...d.accounts.map((a,i)=>`| 待生成账户${i+1} | ${d.customers[a.customerIndex]?.name??'待核对'} | ${a.branchCode} |`)]:['无需新建交易账户。']),
    '',...(d.funds.length?['| 基金 | 代码 | 份额类别 | 模拟净值 |','|---|---|---|---|',...d.funds.map(f=>`| ${f.fundName} | ${f.fundCode} | ${f.shareClass} | ${f.nav} |`)]:['无需新增基金数据。']),
    '',`初始持仓记录：${d.holdings.length}。`,
    '## 预期结果',...p.scenarios.flatMap(s=>['### '+s.title,'准备：'+s.setup,'动作：'+s.action,'预期：'+s.expected,'证据：'+s.evidence]),
    '## 待讨论事项',...[...p.openQuestions,...p.exchangePlan.openQuestions,...d.missing,...p.contract.missing].map(q=>'- '+q),
    ...(![...p.openQuestions,...p.exchangePlan.openQuestions,...d.missing,...p.contract.missing].length?['本次产物未列出缺失事项。']:[]),
    '## 当前进度','审阅方案已在实验内存中保存，下一阶段是确认准备数据；之后再确认预期。此文档仅供查看，没有确认或执行功能。',
  ];
  writeFileSync(output+`${row.id}-${row.method}-review.md`,lines.map((line,i)=>(i?(line.startsWith('|')&&lines[i-1].startsWith('|')?'\n':'\n\n'):'')+line).join('')+'\n');
}
