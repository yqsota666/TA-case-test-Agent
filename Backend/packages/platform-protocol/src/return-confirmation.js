const fail = (code, message) => {
  throw Object.assign(new Error(message), { code, status: 409 });
};

function required(record, field) {
  const value = record?.[field];
  if (typeof value !== 'string' || !value.length || value !== value.trim()) {
    fail('RETURN_CONFIRMATION_INCOMPLETE', `回传确认缺少或含无效 ${field}`);
  }
  return value;
}

function match(source, record, field) {
  if (required(source, field) !== required(record, field)) {
    fail('RETURN_CONFIRMATION_MISMATCH', `回传 ${field} 与申请不一致`);
  }
}

function date(record, field) {
  const value = required(record, field);
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{8}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    fail('RETURN_CONFIRMATION_INCOMPLETE', `${field} 日期无效`);
  }
  return value;
}

function decimal(record, field, scale) {
  const value = required(record, field);
  if (!/^\d+(?:\.\d+)?$/.test(value)) fail('RETURN_CONFIRMATION_VALUES', `${field} 必须为非负精确十进制`);
  const [whole, fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  if (integer.length > 16 - scale || fraction.length > scale) {
    fail('RETURN_CONFIRMATION_VALUES', `${field} 超出协议精度`);
  }
  const padded = fraction.padEnd(scale, '0');
  const units = BigInt(integer + padded);
  if (units <= 0n) fail('RETURN_CONFIRMATION_VALUES', `${field} 必须大于零`);
  return { value: `${integer}.${padded}`, units };
}

export function planReturnConfirmation({ application, returnType, record, channel }) {
  const opening = application?.fileType === '01' && application?.businessCode === '001';
  const subscription = application?.fileType === '03' && application?.businessCode === '022';
  const redemption=application?.fileType==='03' && application?.businessCode==='024';
  if (!opening && !subscription && !redemption) {
    fail('RETURN_CONFIRMATION_UNSUPPORTED', '当前支持开户、申购和赎回的确认生效');
  }
  if (returnType !== (opening ? '02' : '04')) {
    fail('RETURN_CONFIRMATION_MISMATCH', '回传类型与申请不一致');
  }
  if (!['DELIVERED', 'WAITING_RETURN'].includes(application.status)) {
    fail('APPLICATION_NOT_DELIVERED', '申请尚未交付或已经确认，不能再次生效');
  }
  const source = application.record;
  if (required(source, 'BusinessCode') !== application.businessCode ||
      required(record, 'BusinessCode') !== (opening ? '101' : subscription?'122':'124')) {
    fail('RETURN_CONFIRMATION_MISMATCH', '回传业务代码与申请不一致');
  }
  for (const field of ['AppSheetSerialNo', 'DistributorCode', 'TransactionDate', 'TransactionAccountID', 'BranchCode']) {
    match(source, record, field);
  }
  if (required(record, 'DistributorCode') !== channel?.distributorCode) {
    fail('RETURN_CONFIRMATION_MISMATCH', '回传销售机构与通道不一致');
  }
  const requestDate = date(source, 'TransactionDate');
  const confirmationDate = date(record, 'TransactionCfmDate');
  if (confirmationDate < requestDate) fail('RETURN_CONFIRMATION_MISMATCH', '确认日期早于申请日期');
  if (subscription || redemption) {
    for (const field of ['FundCode', 'ShareClass', ...(subscription || source.CurrencyType ? ['CurrencyType']:[])]) match(source, record, field);
    if (source.TAAccountID?.trim()) match(source, record, 'TAAccountID');
    else {
      const opening = application.packagedOpening;
      const original = opening?.record;
      if (!original || original.BusinessCode !== '001' ||
          source.OriginalAppSheetNo !== original.AppSheetSerialNo ||
          source.OriginalAppDate !== original.TransactionDate || source.TransactionDate !== original.TransactionDate ||
          ['TransactionAccountID','DistributorCode','BranchCode'].some(field => !source[field] || source[field] !== original[field])) {
        fail('RETURN_CONFIRMATION_MISMATCH','交易原申请未精确引用同包同账户开户');
      }
      if (opening.confirmedTaAccountId && record.TAAccountID && record.TAAccountID !== opening.confirmedTaAccountId) {
        fail('RETURN_CONFIRMATION_MISMATCH','交易回传TA账号与对应开户02确认不一致');
      }
      if (record.ReturnCode === '0000') {
        if (!opening.confirmedTaAccountId) fail('SALES_ACCOUNT_UNCONFIRMED','须先明确同步对应开户02的成功确认');
        if (record.TAAccountID !== opening.confirmedTaAccountId) fail('RETURN_CONFIRMATION_MISMATCH','交易回传TA账号与对应开户02确认不一致');
      }
    }
    if ((record.ReturnCode === '0000' || record.TAAccountID) && !/^[A-Za-z0-9]{1,12}$/.test(required(record, 'TAAccountID'))) {
      fail('RETURN_CONFIRMATION_INCOMPLETE', 'TA 账号无效');
    }
    if (subscription && record.ApplicationAmount !== null && record.ApplicationAmount !== undefined) {
      if (decimal(source, 'ApplicationAmount', 2).units !== decimal(record, 'ApplicationAmount', 2).units) {
        fail('RETURN_CONFIRMATION_MISMATCH', '回传申请金额与原申请不一致');
      }
    }
  } else {
    if (source.TAAccountID && source.TAAccountID !== record.TAAccountID) {
      fail('RETURN_CONFIRMATION_MISMATCH', '回传 TA 账号与原申请不一致');
    }
    for (const field of ['CertificateType', 'CertificateNo', 'IndividualOrInstitution', 'InvestorName']) {
      if (record[field] !== undefined && record[field] !== null && record[field] !== '') match(source, record, field);
    }
  }
  const returnCode = required(record, 'ReturnCode');
  if (!/^[A-Za-z0-9]{4}$/.test(returnCode)) fail('RETURN_CONFIRMATION_INCOMPLETE', 'TA 返回码无效');
  const success = returnCode === '0000';
  const plan = { outcome: success ? 'CONFIRMED' : 'FAILED', returnCode,
    applicationStatus: success ? 'CONFIRMED' : 'FAILED', accountEffect: null, transactionEffect: null, holdingEffect: null };
  if (!success) return plan;
  required(record, 'TASerialNO');
  if (opening) {
    const taAccountId = required(record, 'TAAccountID');
    if (!/^[A-Za-z0-9]{1,12}$/.test(taAccountId)) fail('RETURN_CONFIRMATION_INCOMPLETE', '成功开户回传缺少有效 TA 账号');
    plan.accountEffect = { transactionAccountId: record.TransactionAccountID, taAccountId,
      investorName: required(source, 'InvestorName'), investorType: required(source, 'IndividualOrInstitution'),
      certificateType: required(source, 'CertificateType'), certificateNo: required(source, 'CertificateNo'),
      branchCode: required(source, 'BranchCode') };
    return plan;
  }
  if (redemption && record.BusinessFinishFlag!=='1')fail('RETURN_CONFIRMATION_UNSUPPORTED','赎回需最终业务完成回传，不能提前扣减持仓');
  if (record.BusinessFinishFlag !== null && record.BusinessFinishFlag !== undefined && record.BusinessFinishFlag !== '' &&
      record.BusinessFinishFlag !== '1') {
    fail('RETURN_CONFIRMATION_UNSUPPORTED', '当前不支持非最终申购回传确认生效');
  }
  const requestedAmount = subscription?decimal(source, 'ApplicationAmount', 2):null;
  const confirmedAmount = decimal(record, 'ConfirmedAmount', 2);
  const confirmedVolume = decimal(record, 'ConfirmedVol', 2);
  const nav = decimal(record, 'NAV', 8);
  if (subscription && confirmedAmount.units > requestedAmount.units) fail('RETURN_CONFIRMATION_VALUES', '确认金额超过申请金额');
  if(redemption && confirmedVolume.units>decimal(source,'ApplicationVol',2).units)fail('RETURN_CONFIRMATION_VALUES','确认赎回份额超过申请份额');
  if(redemption && record.ApplicationVol && decimal(record,'ApplicationVol',2).units!==decimal(source,'ApplicationVol',2).units)fail('RETURN_CONFIRMATION_MISMATCH','回传申请份额与原申请不一致');
  plan.transactionEffect = { businessCode: application.businessCode, fundCode: record.FundCode, shareClass: record.ShareClass,
    confirmedAmount: confirmedAmount.value, confirmedVolume: confirmedVolume.value, nav: nav.value,
    confirmationDate: `${confirmationDate.slice(0, 4)}-${confirmationDate.slice(4, 6)}-${confirmationDate.slice(6)}` };
  plan.holdingEffect = { fundCode: record.FundCode, shareClass: record.ShareClass, volumeDelta: redemption?'-'+confirmedVolume.value:confirmedVolume.value };
  return plan;
}
