const labels = {
  confirmedAmount: ['确认成交金额', '确认金额', 'confirmedAmount', 'confirmed amount'],
  confirmedVolume: ['确认成交份额', '确认份额', '确认份数', 'ConfirmedVol', 'confirmedVolume', 'confirmed volume'],
  totalVolume: ['总份额', '总份数', '总持仓', '持仓总量', '持仓份额', '最终正式持仓', '正式持仓', '最终持仓', '持仓', 'totalVolume', 'total volume'],
  availableVolume: ['可用份额', '可用份数', '可用持仓', '可用', 'availableVolume', 'available volume'],
  frozenVolume: ['冻结份额', '冻结份数', '冻结持仓', '冻结', 'frozenVolume', 'frozen volume'],
};
const aliases = Object.entries(labels).flatMap(([field, names]) => names.map(name => ({ field, name })));
const marker = new RegExp(aliases.map(({ name }) => name).sort((a, b) => b.length - a.length).join('|'), 'gi');
export function preciseDecimal(value) {
  if (!/^-?\d+(?:\.\d{1,8})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).replace(/^-/, '').split('.');
  return (BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'))) * (String(value).startsWith('-') ? -1n : 1n);
}
function fieldPrefix(text, at) {
  return text.slice(0, at).split(/[，,。；;\n]/).at(-1);
}
function uncertainTail(tail) {
  return /[?？]|吗|是否|还是|或|\bor\b|[\/|]/i.test(tail.split(/[，,。；;\n]/)[0]);
}
function negatedPrefix(prefix) {
  return /(?:不|未|没有|非|\bnot\b)/i.test(prefix.replace(/不(?:少于|低于|超过|高于|多于)/g, ''));
}
export function numericQuoteBindingSpans(quote) {
  const text = String(quote).replace(/[−－]/g, '-');
  const matches = [...text.matchAll(marker)], bindings = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const prefix = fieldPrefix(text, match.index);
    if (negatedPrefix(prefix)) continue;
    const segment = text.slice(match.index + match[0].length, matches[i + 1]?.index);
    // A quantity must immediately follow its field, allowing only comparison language and units.
    const parsed = segment.match(/^((?:\s|[=:：≤≥]|>=|<=|应为|应该为|应当为|应达到|为|是|等于|至少|最多|不低于|不少于|大于等于|小于等于|不超过|不高于|不多于)*)([-+]?\d+(?:\.\d+)?)(?!\s*(?:[A-Za-z0-9_.+\-/%％×*÷万亿千百十]|[,，]\d))/);
    const value = parsed?.[2]?.replace(/^\+/, '');
    if (value === undefined || preciseDecimal(value) === null || uncertainTail(segment.slice(parsed[0].length))) continue;
    const field = aliases.find(alias => alias.name.toLowerCase() === match[0].toLowerCase()).field;
    const before = prefix.match(/(?:至少|不低于|不少于|大于等于|>=|≥|最多|不高于|不超过|不多于|小于等于|<=|≤)\s*$/)?.[0] ?? '';
    const comparison = before + parsed[1];
    const operator = /(至少|不低于|不少于|大于等于|>=|≥)/.test(comparison) ? 'gte' :
      /(最多|不高于|不超过|不多于|小于等于|<=|≤)/.test(comparison) ? 'lte' : 'eq';
    const end=match.index+match[0].length+parsed[0].length;
    const unit=text.slice(end).match(/^\s*(?:元|份)/)?.[0]??'';
    bindings.push({ field, value, operator, start:match.index-before.length, end:end+unit.length });
  }
  return bindings;
}
export function numericQuoteBindings(quote) {
 return numericQuoteBindingSpans(quote).map(({field,value,operator})=>({field,value,operator}));
}
export function hasNumericFieldExpectation(field, value, quote, operator) {
  const expected = preciseDecimal(value);
  return expected !== null && numericQuoteBindings(quote).some(binding => binding.field === field && preciseDecimal(binding.value) === expected && (operator === undefined || binding.operator === operator));
}
const literalLabels = {
  status: ['最终状态', '申请状态', '确认状态', '状态', '确认成功', 'status'],
  returnCode: ['TA返回代码', '返回代码', '返回码', '结果代码', '结果码', '错误代码', '错误码', 'returnCode'],
  transactionAccountId: ['交易账户号', '交易账号', '交易账户', '销售账号', 'transactionAccountId'],
  taAccountId: ['TA账户号', 'TA账号', 'TA账户', 'TA号', 'taAccountId'],
  fundCode: ['基金代码', '基金编码', 'fundCode'],
  shareClass: ['份额类别', '份额分类', 'shareClass'],
  branchCode: ['网点编号', '网点代码', '网点', 'branchCode'],
  snapshotDate: ['确认日期', '快照日期', '业务日期', '快照日', '日期', 'snapshotDate'],
};
const literalAliases = Object.entries(literalLabels).flatMap(([field, names]) => names.map(name => ({ field, name })));
const literalMarker = new RegExp(literalAliases.map(({ name }) => name).sort((a, b) => b.length - a.length).join('|'), 'gi');
export function hasLiteralExpectation(value, quote, field) {
  if (typeof value !== 'string' || !value.length || !Object.hasOwn(literalLabels, field)) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const positive = new RegExp(`^(?:\\s|[=:：,，]|均为|应为|应该为|应当为|为|是|等于)*${escaped}(?![A-Za-z0-9_.+-])`);
  const matches = [...String(quote).matchAll(literalMarker)];
  return matches.some((match, i) => {
    const alias = literalAliases.find(alias => alias.name.toLowerCase() === match[0].toLowerCase());
    if (alias.name === '确认成功' && value !== 'CONFIRMED') return false;
    if (alias.field !== field || negatedPrefix(fieldPrefix(quote, match.index)) || /是否/.test(fieldPrefix(quote, match.index))) return false;
    const segment = quote.slice(match.index + match[0].length, matches[i + 1]?.index);
    const matched=positive.exec(segment);
    if(!matched)return false;
    const tail=segment.slice(matched[0].length).split(/[，,。；;\n]/)[0];
    return !uncertainTail(tail);
  });
}
