import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { buildDataFile, buildIndexFile, dataFileName, encodeField, EXCHANGE_STREAMS, FIELD_REQUIREMENTS, FILE_DEFINITIONS, indexFileName, inspectDataFile, inspectIndexFile, normalizeExchangeFile, parseDataFile, parseIndexFile, TRANSACTION_BUSINESSES } from '../src/index.js';

test('encodes Chinese character fields by GB18030 byte length', () => {
  const encoded = encodeField({ name: 'name', type: 'C', length: 8, scale: 0 }, '广发');
  assert.equal(encoded.length, 8);
  assert.equal(iconv.decode(encoded, 'gb18030').trim(), '广发');
});

test('round trips a strict 07 data file and OFJ index', () => {
  const header = { creator: 'TA001', receiver: 'SALES001', date: '20260916', fileType: '07' };
  const record = {
    FundName: '广发演示成长基金', TotalFundVol: '1000000.00', FundCode: '000001', FundStatus: '0',
    NAV: '1.25000000', UpdateDate: '20260916', NetValueType: '0', AccumulativeNAV: '1.30000000',
    ConvertStatus: '3', PeriodicStatus: '3', TransferAgencyStatus: '3', FundSize: '1250000.00',
    CurrencyType: '156', AnnouncFlag: '0', MinBidsAmountByIndi: '100.00', MinAppBidsAmountByIndi: '100.00',
    CollectFeeType: '0', NextTradeDate: '20260917', FundType: '01', FundTypeName: '混合型',
    FundManagerName: '广发基金管理有限公司', IndiMaxPurchase: '1000000.00', IndiDayMaxSumBuy: '2000000.00'
  };
  const data = buildDataFile({ ...header, records: [record] });
  const parsed = parseDataFile(data);
  assert.equal(parsed.records[0].FundName, record.FundName);
  assert.equal(parsed.records[0].NAV, record.NAV);
  const dataName = dataFileName(header);
  const indexName = indexFileName(header);
  assert.match(dataName, /_07\.TXT$/);
  assert.match(indexName, /^OFJ_/);
  const index = buildIndexFile({ ...header, fileNames: [dataName] });
  assert.deepEqual(parseIndexFile(index).fileNames, [dataName]);
  const inspected = inspectDataFile(data);
  assert.equal(inspected.records[0].values.FundCode, '000001');
  assert.equal(inspected.fields[0].start, 1);
  assert.equal(inspected.fields.at(-1).end, inspected.fields.reduce((sum, field) => sum + field.length, 0));
  assert.equal(inspectIndexFile(index).fileNames[0], dataName);
});

test('uses the complete FFReader 2.2 structures and space-padded version', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FILE_DEFINITIONS).map(([fileType, fields]) => [fileType, fields.length])),
    { '01': 89, '02': 27, '03': 82, '04': 122, '05': 23, '07': 86 }
  );
  const data = buildDataFile({ creator: '305', receiver: '27', date: '20260917', fileType: '01', records: [{}] });
  const index = buildIndexFile({ creator: '305', receiver: '27', date: '20260917', fileNames: ['OFD_305_27_20260917_01.TXT'] });
  assert.equal(data.subarray(10, 18).toString('ascii'), '22      ');
  assert.equal(index.subarray(10, 18).toString('ascii'), '22      ');
});

test('uses the V2.2 index prefix assigned to each exchange stream', () => {
  const nameFor = (fileType) => indexFileName({ creator: '305', receiver: '27', date: '20260917', fileType });
  for (const fileType of ['01', '02', '03', '04', '05']) assert.match(nameFor(fileType), /^OFI_/);
  assert.match(nameFor('07'), /^OFJ_/);
  assert.match(indexFileName({ creator: '27', receiver: '305', date: '20260917', streamId: 'taEarlyConfirmation' }), /^OFF_/);
  assert.equal(EXCHANGE_STREAMS.taConfirmation.direction, 'ta-to-sales');
  assert.deepEqual(EXCHANGE_STREAMS.taConfirmation.fileTypes.slice(0, 3), ['02', '04', '05']);
});

test('one index can declare multiple data files in the same exchange package', () => {
  const header = { creator: '305', receiver: '27', date: '20260917' };
  const fileNames = [
    dataFileName({ ...header, fileType: '01' }),
    dataFileName({ ...header, fileType: '03' })
  ];
  const index = buildIndexFile({ ...header, fileNames });
  assert.deepEqual(parseIndexFile(index).fileNames, fileNames);
  assert.equal(inspectIndexFile(index).fileCount, 2);
});

test('normalizes files with the legacy zero-padded version for FFReader', () => {
  const current = buildDataFile({ creator: '305', receiver: '27', date: '20260917', fileType: '01', records: [{}] });
  const legacyHeader = Buffer.from(current);
  Buffer.from('00000022').copy(legacyHeader, 10);
  const normalized = normalizeExchangeFile(legacyHeader);
  assert.equal(normalized.subarray(10, 18).toString('ascii'), '22      ');
  assert.equal(parseDataFile(normalized).fields.length, 89);
});

test('rejects wrong record count', () => {
  const data = buildDataFile({ creator: 'TA001', receiver: 'SALES001', date: '20260916', fileType: '05', records: [] });
  const broken = Buffer.from(data);
  const marker = Buffer.from('0000000000000000');
  const offset = broken.indexOf(marker, 100);
  marker.copy(broken, offset);
  broken[offset + 15] = 0x31;
  assert.throws(() => parseDataFile(broken), /Record count/);
});

test('publishes required and conditional metadata for editable sales files', () => {
  assert.ok(FIELD_REQUIREMENTS['01'].required.includes('AppSheetSerialNo'));
  assert.ok(FIELD_REQUIREMENTS['01'].conditional.DepositAcct);
  for (const code of ['002','003','004','005','006','007','008','009']) {
    assert.deepEqual(FIELD_REQUIREMENTS['01'].requiredByBusiness[code], ['TAAccountID']);
  }
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['022'].includes('ApplicationAmount'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['024'].includes('ApplicationVol'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['020'].includes('ApplicationAmount'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['026'].includes('TargetDistributorCode'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['036'].includes('CodeOfTargetFund'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['029'].includes('DefDividendMethod'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['052'].includes('OriginalAppSheetNo'));
  assert.ok(FIELD_REQUIREMENTS['03'].requiredByBusiness['070'].includes('TargetRegionCode'));
  assert.ok(FIELD_REQUIREMENTS['03'].conditional.ShareClass);
});

test('maps protocol optional fields to each supported 03 business', () => {
  const fieldNames = new Set(FILE_DEFINITIONS['03'].map((field) => field.name));
  for (const business of Object.values(TRANSACTION_BUSINESSES)) {
    assert.ok(Array.isArray(business.optional03));
    assert.ok(business.optional03.every((name) => fieldNames.has(name)));
    assert.deepEqual(business.optional03.filter((name) => business.required03.includes(name)), []);
  }
  assert.ok(TRANSACTION_BUSINESSES['022'].optional03.includes('DiscountRateOfCommission'));
  assert.ok(TRANSACTION_BUSINESSES['024'].optional03.includes('OriginalSerialNo'));
  assert.ok(TRANSACTION_BUSINESSES['031'].optional03.includes('FreezingDeadline'));
  assert.ok(TRANSACTION_BUSINESSES['052'].optional03.includes('OriginalAppDate'));
  assert.equal(TRANSACTION_BUSINESSES['020'].confirmationCode, '120');
  assert.equal(TRANSACTION_BUSINESSES['026'].confirmationCode, '126');
  assert.equal(TRANSACTION_BUSINESSES['036'].confirmationCode, '136');
});

test('round trips subscription, transfer custody, and fund conversion protocol fields', () => {
  const base = {
    TransactionDate:'20260918', TransactionTime:'120000', TransactionAccountID:'20260918000000001',
    DistributorCode:'305', TAAccountID:'TA0000000001', BranchCode:'305', ShareClass:'0'
  };
  const records = [
    {...base,AppSheetSerialNo:'T020202609180000000001',FundCode:'000001',BusinessCode:'020',CurrencyType:'156',ApplicationAmount:'1000.00'},
    {...base,AppSheetSerialNo:'T026202609180000000001',FundCode:'000001',BusinessCode:'026',ApplicationVol:'100.00',TargetDistributorCode:'306',TargetTransactionAccountID:'20260918000000002'},
    {...base,AppSheetSerialNo:'T036202609180000000001',FundCode:'000001',BusinessCode:'036',ApplicationVol:'100.00',CodeOfTargetFund:'000003',LargeRedemptionFlag:'0',DiscountRateOfCommission:'1.0000',BackenloadDiscount:'1.0000',TargetShareType:'0',ChargeType:'0'}
  ];
  const parsed = parseDataFile(buildDataFile({creator:'305',receiver:'27',date:'20260918',fileType:'03',records}));
  assert.deepEqual(parsed.records.map(record => record.BusinessCode), ['020','026','036']);
  assert.equal(parsed.records[1].TargetDistributorCode, '306');
  assert.equal(parsed.records[2].CodeOfTargetFund, '000003');
});

test('round trips all nine account businesses in one 01 file', () => {
  const records = ['001','002','003','004','005','006','007','008','009'].map((businessCode, index) => ({
    AppSheetSerialNo: `AC20260918${String(index + 1).padStart(8, '0')}`, CertificateType: '0',
    CertificateNo: '510107199907080055', InvestorName: '赵子航',
    TransactionDate: '20260918', TransactionTime: '120000', IndividualOrInstitution: '1',
    TransactionAccountID: `20260918${String(index + 1).padStart(9, '0')}`, DistributorCode: '305', BusinessCode: businessCode,
    BranchCode: '305', TAAccountID: businessCode === '001' ? null : 'TA0000000001', MobileTelNo: '13900139000'
  }));
  const data = buildDataFile({
    creator: '305', receiver: '27', date: '20260918', fileType: '01',
    records
  });
  const inspected = inspectDataFile(data);
  assert.deepEqual(inspected.records.map((record) => record.values.BusinessCode), ['001','002','003','004','005','006','007','008','009']);
  assert.equal(inspected.records[0].values.TAAccountID, null);
  assert.ok(inspected.records.slice(1).every((record) => record.values.TAAccountID === 'TA0000000001'));
});
