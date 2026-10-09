import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDeliveryPackage, normalizeDeliveryProfile, deliveryDataFileName} from '../src/delivery-package.js';
import {buildDataFile, parseDataFile, parseIndexFile} from '../src/codec.js';

function applications({code = '227', count = 1, type = '1', includeTrade = true} = {}) {
  const wire = {creator: code, receiver: '27', date: '20260817', version: '22'};
  const records = Array.from({length: count}, (_, i) => ({AppSheetSerialNo: `OPEN${i}`, BusinessCode: '001',
    DistributorCode: code, BranchCode: code, TransactionDate: wire.date, TransactionTime: '090000',
    TransactionAccountID: `SYN${i}`, IndividualOrInstitution: type, InvestorName: `合成客户${i}`,
    CertificateType: '0', CertificateNo: `SYNID${i}`}));
  const trades = records.map(r => ({...r, AppSheetSerialNo: `TRADE${r.AppSheetSerialNo}`, BusinessCode: '022',
    OriginalAppSheetNo: r.AppSheetSerialNo, OriginalAppDate: r.TransactionDate, TransactionTime: '100000',
    FundCode: '000008', ApplicationAmount: '1000.00', ShareClass: '0'}));
  return ['01', ...(includeTrade ? ['03'] : [])].map(t => ({fileName: `OFD_${code}_27_20260817_${t}.TXT`,
    rawBytes: buildDataFile({...wire, fileType: t, records: t === '01' ? records : trades})}));
}
function members(result) {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-package-'));
  try {
    const path = join(dir, result.fileName); writeFileSync(path, result.rawBytes);
    const json = JSON.parse(execFileSync('/usr/bin/python3', ['-c',
      'import zipfile,sys,json,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))', path], {encoding: 'utf8'}));
    return Object.fromEntries(Object.entries(json).map(([n, b]) => [n, Buffer.from(b, 'base64')]));
  } finally { rmSync(dir, {recursive: true}); }
}
const profile227 = {includeEmptyR1: true, dataSequence: false, trailingCrlf: true, fieldNamesCase: 'canonical'};

test('227 sample structure has seven referenced files, exact source bytes and date-only ZIP', () => {
  for (const count of [1, 2, 4]) {
    const source = applications({count}); const result = buildDeliveryPackage(source, profile227);
    assert.equal(result.fileName, '20260817.zip'); assert.equal(result.fileNames.length, 7);
    const files = members(result); const prefix = '227/20260817/';
    for (const f of source) assert.deepEqual(files[prefix + f.fileName], f.rawBytes);
    assert.deepEqual(parseIndexFile(files[prefix + 'OFI_227_27_20260817.TXT']).fileNames,
      ['OFD_227_27_20260817_01.TXT', 'OFD_227_27_20260817_03.TXT', 'OFD_227_27_20260817_R1.TXT']);
    assert.deepEqual(parseIndexFile(files[prefix + 'OFX_227_27_20260817.TXT']).fileNames,
      ['OFD_227_27_20260817_X1.TXT', 'OFD_227_27_20260817_X3.TXT']);
    const x1 = parseDataFile(files[prefix + 'OFD_227_27_20260817_X1.TXT']);
    assert.equal(x1.records.length, count);
    assert.equal(new Set(x1.records.map(r => r.AppSheetSerialNo)).size, count);
    for (const [i, r] of x1.records.entries()) {
      assert.equal(r.OriginalAppSheetNo, `OPEN${i}`); assert.equal(r.OriginalAppDate, '20260817');
      assert.equal(r.CertificateNo, `SYNID${i}`); assert.equal(r.TAAccountID, null);
    }
    for (const type of ['X3', 'R1']) assert.equal(parseDataFile(files[prefix + `OFD_227_27_20260817_${type}.TXT`]).records.length, 0);
  }
});
test('institution AML uses X3 and new-account ZIP may contain only 01 without a trade', () => {
  const result = buildDeliveryPackage(applications({type: '0', includeTrade: false}), profile227);
  const files = members(result);
  assert.equal(result.fileNames.length, 6);
  assert.equal(parseDataFile(files['227/20260817/OFD_227_27_20260817_X3.TXT']).records.length, 1);
  assert.equal(parseDataFile(files['227/20260817/OFD_227_27_20260817_X1.TXT']).records.length, 0);
});
test('custom suffix, directory and AML policies vary by channel without hardcoded customer cases', () => {
  const result = buildDeliveryPackage(applications({code: '005'}), {dataSequence: false,
    indexSuffixes: {OFI: '-DLJ', OFX: '-CUSTOM'}, directoryLayout: 'date'});
  assert.ok(result.fileNames.includes('20260817/OFI_005_27_20260817-DLJ.TXT'));
  assert.ok(result.fileNames.includes('20260817/OFX_005_27_20260817-CUSTOM.TXT'));
  assert.equal(buildDeliveryPackage(applications({code: '926'}), {aml: false, directoryLayout: 'flat'}).fileNames.length, 3);
  assert.throws(() => normalizeDeliveryProfile({indexSuffixes: {OFI: '/../'}}), /后缀/);
  assert.throws(() => normalizeDeliveryProfile({directoryLayout: '../'}), /格式/);
  assert.throws(() => normalizeDeliveryProfile({extra: true}), /字段/);
  assert.throws(() => normalizeDeliveryProfile({aml: true}, '21'), /协议版本/);
});
test('missing AML identity, wrong date, cross-account reference and source tampering reject the package', () => {
  const source = applications({count: 2});
  const first = parseDataFile(source[0].rawBytes);
  first.records[0].CertificateNo = null;
  const missing = {...source[0], rawBytes: buildDataFile({...first, records: first.records})};
  assert.throws(() => buildDeliveryPackage([missing, source[1]], profile227), /资料不足/);
  const trades = parseDataFile(source[1].rawBytes);
  trades.records[0].OriginalAppSheetNo = 'OPEN1';
  assert.throws(() => buildDeliveryPackage([source[0], {...source[1], rawBytes: buildDataFile(trades)}]), /精确引用/);
  assert.throws(() => buildDeliveryPackage([{...source[0], sha256: 'bad'}]), /校验失败/);
  assert.throws(() => buildDeliveryPackage(applications({type:'2'})), /客户类型/);
  assert.throws(() => buildDeliveryPackage([source[0], {...source[1], rawBytes:buildDataFile({...trades,date:'20260818'})}]), /不同机构/);
  first.records[0].TransactionDate = '20260818';
  assert.throws(() => buildDeliveryPackage([{...source[0], rawBytes: buildDataFile(first)}]), /日期/);
});
test('R1 field list and zero-record envelope match the sanitized local reference schema', () => {
  const r = parseDataFile(buildDataFile({creator: '227', receiver: '27', date: '20260817', fileType: 'R1', records: []}));
  assert.equal(r.fields.length, 59); assert.equal(r.fields[0].name, 'AppSheetSerialNo');
  assert.equal(r.fields.at(-1).name, 'ReservedField6');
  assert.equal(r.records.length, 0);
});
