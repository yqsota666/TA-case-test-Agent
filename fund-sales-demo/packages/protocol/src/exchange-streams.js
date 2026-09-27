export const EXCHANGE_STREAMS = {
  salesApplication: {
    id: 'salesApplication',
    name: '销售申请批次',
    direction: 'sales-to-ta',
    indexKind: 'OFI',
    fileTypes: ['01', '03', '13', '23', 'R1'],
    emptyIndexRequired: true
  },
  salesTransferApplication: {
    id: 'salesTransferApplication',
    name: 'T 日过户申报批次',
    direction: 'sales-to-ta',
    indexKind: 'OFT',
    fileTypes: ['33']
  },
  salesAml: {
    id: 'salesAml',
    name: '销售反洗钱批次',
    direction: 'sales-to-ta',
    indexKind: 'OFX',
    fileTypes: ['X1', 'X3'],
    emptyIndexRequired: true
  },
  taMarketData: {
    id: 'taMarketData',
    name: 'TA 行情与公告批次',
    direction: 'ta-to-sales',
    indexKind: 'OFJ',
    fileTypes: ['07', '08', '21']
  },
  taApplicationSummary: {
    id: 'taApplicationSummary',
    name: 'TA 业务申请汇总批次',
    direction: 'ta-to-sales',
    indexKind: 'OFS',
    fileTypes: ['11']
  },
  taConfirmation: {
    id: 'taConfirmation',
    name: 'TA 确认批次',
    direction: 'ta-to-sales',
    indexKind: 'OFI',
    fileTypes: ['02', '04', '05', '06', '09', '12', '24', '26', 'R2']
  },
  taSettlement: {
    id: 'taSettlement',
    name: 'TA 资金清算批次',
    direction: 'ta-to-sales',
    indexKind: 'OFK',
    fileTypes: ['10', '25']
  },
  taParameters: {
    id: 'taParameters',
    name: 'TA 参数批次',
    direction: 'ta-to-sales',
    indexKind: 'OFC',
    fileTypes: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']
  },
  taEarlyConfirmation: {
    id: 'taEarlyConfirmation',
    name: 'TA 提前回报批次',
    direction: 'ta-to-sales',
    indexKind: 'OFF',
    fileTypes: ['04']
  },
  taTransferConfirmation: {
    id: 'taTransferConfirmation',
    name: 'T 日过户回报批次',
    direction: 'ta-to-sales',
    indexKind: 'OFB',
    fileTypes: ['34', '35']
  }
};

export function exchangeStream(streamId) {
  const stream = EXCHANGE_STREAMS[streamId];
  if (!stream) throw new Error(`Unsupported exchange stream ${streamId}`);
  return stream;
}

export function defaultExchangeStreamForFile(fileType) {
  const matches = Object.values(EXCHANGE_STREAMS).filter((stream) => stream.fileTypes.includes(fileType));
  if (!matches.length) throw new Error(`No exchange stream for file type ${fileType}`);
  // 04 can also be sent as an early confirmation. The regular confirmation stream
  // is the protocol default; callers must opt into taEarlyConfirmation explicitly.
  return matches.find((stream) => stream.id === 'taConfirmation') || matches[0];
}

export function indexKindFor({ streamId, fileType }) {
  return streamId ? exchangeStream(streamId).indexKind : defaultExchangeStreamForFile(fileType).indexKind;
}
