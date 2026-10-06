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
export function numericQuoteBindings(quote) {
  const text = String(quote).replace(/[−－]/g, '-');
  const matches = [...text.matchAll(marker)], bindings = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const segment = text.slice(match.index + match[0].length, matches[i + 1]?.index);
    // A quantity must immediately follow its field, allowing only comparison language and units.
    const parsed = segment.match(/^((?:\s|[=:：≤≥]|>=|<=|应为|应该为|应当为|应达到|为|是|等于|至少|最多|不低于|不少于|大于等于|小于等于|不超过|不高于|不多于)*)([-+]?\d+(?:\.\d+)?)(?!\s*(?:[A-Za-z0-9_.+\-/%％×*÷万亿千百十]|[,，]\d))/);
    const value = parsed?.[2]?.replace(/^\+/, '');
    if (value === undefined || preciseDecimal(value) === null) continue;
    const field = aliases.find(alias => alias.name.toLowerCase() === match[0].toLowerCase()).field;
    const operator = /(至少|不低于|不少于|大于等于|>=|≥)/.test(parsed[1]) ? 'gte' :
      /(最多|不高于|不超过|不多于|小于等于|<=|≤)/.test(parsed[1]) ? 'lte' : 'eq';
    bindings.push({ field, value, operator });
  }
  return bindings;
}
export function hasNumericFieldExpectation(field, value, quote, operator) {
  const expected = preciseDecimal(value);
  return expected !== null && numericQuoteBindings(quote).some(binding => binding.field === field && preciseDecimal(binding.value) === expected && (operator === undefined || binding.operator === operator));
}
export function hasLiteralExpectation(value, quote) {
  if (typeof value !== 'string' || !value.length) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_.+-])${escaped}(?![A-Za-z0-9_.+-])`).test(quote);
}
