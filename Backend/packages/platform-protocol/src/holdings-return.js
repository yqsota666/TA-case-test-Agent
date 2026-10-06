import { returnParsingError } from './return-parsing.js';
const fail = (code, message) => { throw returnParsingError(code, message, 409); };
export const volumeUnits = value => {
  if (typeof value !== 'string' || !/^\d{1,14}\.\d{2}$/.test(value)) fail('INVALID_HOLDING_VOLUME', '持仓数量必须为非负、精确到两位小数的协议数值');
  return BigInt(value.replace('.', ''));
};
export const volumeText = units => {
  if (units < 0n || units > 9999999999999999n) fail('HOLDING_VOLUME_OVERFLOW', '同步后的持仓超出协议数量范围');
  return `${units / 100n}.${String(units % 100n).padStart(2, '0')}`;
};
const validDate = value => {
  if (!/^\d{8}$/.test(value ?? '')) return false;
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso;
};
export function planHoldingsSync(packageResult, channel) {
  const seen = new Set();
  return packageResult.files.flatMap(file => file.records.map((record, localIndex) => {
    const row = { fileName: file.fileName, localIndex, record };
    if (!['0','1','A'].includes(record.DetailFlag) ||
        (record.WholeFlag != null && !['0','1'].includes(record.WholeFlag))) fail('INVALID_HOLDING_FLAGS', '05明细标志或全量标志无效');
    if (!validDate(record.TransactionCfmDate) || record.TransactionCfmDate > file.date ||
        !record.FundCode || !['0','1'].includes(record.ShareClass)) fail('INVALID_HOLDING_RECORD', '05基金、收费方式或确认日期无效');
    const total = volumeUnits(record.TotalVolOfDistributorInTA);
    const available = volumeUnits(record.AvailableVol);
    const frozen = record.TotalFrozenVol == null ? null : volumeUnits(record.TotalFrozenVol);
    if (available > total || (frozen != null && (frozen > total || available + frozen > total))) fail('INVALID_HOLDING_BALANCE', '05可用或冻结份额超过总份额');
    if (record.DetailFlag !== '0') return { ...row, status: record.DetailFlag === '1' ? 'DETAIL_ONLY' : 'FUND_SUMMARY_ONLY' };
    if (!record.TransactionAccountID || !record.TAAccountID || !record.BranchCode || record.DistributorCode !== channel.distributorCode) {
      fail('HOLDING_ACCOUNT_REQUIRED', '05账户余额缺少账号、网点或销售机构不匹配');
    }
    const key = JSON.stringify([record.TransactionAccountID,record.TAAccountID,record.FundCode,record.ShareClass]);
    if (seen.has(key)) fail('DUPLICATE_HOLDING_BALANCE', '同一包存在重复账户基金余额，不能重复或相互覆盖');
    seen.add(key);
    return { ...row, status: 'READY', total: volumeText(total), available: volumeText(available),
      frozen: frozen == null ? null : volumeText(frozen), date: record.TransactionCfmDate };
  }));
}
