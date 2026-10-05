// A stable envelope for business consumers. Version-specific fields remain in
// `fields`; shared identifiers and amounts have the same shape for V2.1/V2.2.
export const FILE_BUSINESS_KINDS = {
  '01': 'accountApplication', '02': 'accountConfirmation',
  '03': 'transactionApplication', '04': 'transactionConfirmation',
  '05': 'positionSnapshot', '06': 'dividendConfirmation',
  '07': 'fundParameters', '09': 'dividendSummary',
  '10': 'settlementSummary', '11': 'applicationSummary',
  '12': 'confirmationSummary', '24': 'otherConfirmation',
  '25': 'settlementInstruction', '26': 'otherConfirmation',
  'R2': 'taxConfirmation', 'X1': 'amlApplication',
  'X2': 'amlConfirmation', 'X3': 'amlApplication',
  'X4': 'amlConfirmation'
};

export function mapBusinessRecord(record, { version, fileType, creator, receiver, date, index }) {
  return {
    kind: FILE_BUSINESS_KINDS[fileType] || 'protocolRecord',
    source: { version, fileType, creator, receiver, date, index },
    applicationNo: record.AppSheetSerialNo || null,
    businessCode: record.BusinessCode || null,
    returnCode: record.ReturnCode || null,
    account: {
      distributorCode: record.DistributorCode || null,
      taAccountId: record.TAAccountID || null,
      transactionAccountId: record.TransactionAccountID || null,
      investorName: record.InvestorName || null,
      certificateType: record.CertificateType || null,
      certificateNo: record.CertificateNo || null
    },
    fund: {
      code: record.FundCode || null,
      shareClass: record.ShareClass || null
    },
    position: fileType === '05' ? {
      availableVolume: record.AvailableVol || null,
      totalVolume: record.TotalVolOfDistributorInTA || null,
      frozenVolume: record.TotalFrozenVol || null,
      wholeFlag: record.WholeFlag || null
    } : null,
    fields: record
  };
}
