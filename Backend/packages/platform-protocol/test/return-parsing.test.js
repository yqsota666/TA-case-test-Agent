import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDataFile, buildIndexFile, fieldsForFile } from '../src/index.js';
import { parseReturnFiles, MAX_RETURN_BYTES } from '../src/return-parsing.js';
const channel = { taCode: '27', distributorCode: '306', protocolVersion: '22' };
const options = expectedType => ({ expectedType, channel });
const name = (type, date = '20261007') => `OFD_27_306_${date}_${type}_001.TXT`;
const upload = (fileName, bytes) => ({ fileName, base64: bytes.toString('base64') });
const raw = (type = '02', version = '22', extra = {}) => buildDataFile({ creator: '27', receiver: '306',
  date: '20261007', fileType: type, version, records: [{ InvestorName: '测试客户甲', AppSheetSerialNo: 'TEST001',
    ReturnCode: '0000', BusinessCode: type === '02' ? '101' : '122', ConfirmedAmount: '450.00',
    ConfirmedVol: '450.00000000', NAV: '1.00000000', ...extra }] });

test('separate 02/04 parsing preserves Chinese, decimals, nulls, source and raw bytes', () => {
  for (const type of ['02', '04']) {
    const bytes = raw(type);
    const parsed = parseReturnFiles([upload(name(type), bytes)], options(type));
    if (type === '02') assert.equal(parsed.result.files[0].records[0].InvestorName, '测试客户甲');
    assert.equal(parsed.result.files[0].records[0].AppSheetSerialNo, 'TEST001');
    assert.equal(parsed.result.files[0].businessRecords[0].source.index, 1);
    assert.equal(parsed.result.files[0].fields.length, fieldsForFile('22', type).length);
    assert.equal(parsed.result.files[0].records[0].TAAccountID, null);
    assert.equal(parsed.result.businessApplied, false);
    assert.equal(parsed.result.applicationsMatched, false);
    assert.equal(parsed.result.indexChecked, false);
    assert.deepEqual(parsed.rawFiles[0].rawBytes, bytes);
    if (type === '04') {
      assert.equal(parsed.result.files[0].records[0].ConfirmedAmount, '450.00');
      assert.equal(parsed.result.files[0].records[0].ConfirmedVol, '450.00');
      assert.equal(parsed.result.files[0].records[0].NAV, '1.00000000');
    }
  }
});

test('reads 21/22, final CRLF, empty file and business failure without treating failure as parse error', () => {
  for (const version of ['21', '22']) {
    for (const type of ['02', '04']) {
      const parsed = parseReturnFiles([upload(name(type), Buffer.concat([raw(type, version, { ReturnCode: '1001' }), Buffer.from('\r\n')]))],
        { expectedType: type, channel: { ...channel, protocolVersion: version } });
      assert.equal(parsed.result.files[0].records[0].ReturnCode, '1001');
      assert.equal(parsed.result.files[0].version, version);
    }
  }
  const empty = buildDataFile({ creator: '27', receiver: '306', date: '20261007', fileType: '02', records: [] });
  assert.equal(parseReturnFiles([upload(name('02'), empty)], options('02')).result.recordCount, 0);
});

test('optional OFI must exactly cover uploaded shards and match headers; order does not change digest', () => {
  const one = upload(name('02'), raw());
  const two = upload(name('02').replace('001', '002'), raw('02', '22', { AppSheetSerialNo: 'TEST002' }));
  const index = upload('OFI_27_306_20261007.TXT', buildIndexFile({ creator: '27', receiver: '306', date: '20261007', fileNames: [one.fileName, two.fileName] }));
  const parsed = parseReturnFiles([index, one, two], options('02'));
  assert.equal(parsed.result.recordCount, 2);
  assert.equal(parsed.result.indexChecked, true);
  assert.equal(parsed.result.sha256, parseReturnFiles([two, index, one], options('02')).result.sha256);
  assert.throws(() => parseReturnFiles([index, one], options('02')), { code: 'RETURN_INDEX_MISMATCH' });
  assert.throws(() => parseReturnFiles([index], options('02')), { code: 'RETURN_DATA_REQUIRED' });
});

test('rejects wrong type, filename, channel/version, bad date and mixed file days', () => {
  assert.throws(() => parseReturnFiles([upload(name('04'), raw('04'))], options('02')), { code: 'RETURN_TYPE_MISMATCH' });
  assert.throws(() => parseReturnFiles([upload(name('02'), raw())], options('04')), { code: 'RETURN_TYPE_MISMATCH' });
  assert.throws(() => parseReturnFiles([upload(name('02').replace('27_', '28_'), raw())], options('02')), { code: 'RETURN_NAME_MISMATCH' });
  assert.throws(() => parseReturnFiles([upload(name('02'), raw())], { expectedType: '02', channel: { ...channel, taCode: '28' } }), { code: 'FILE_CHANNEL_MISMATCH' });
  assert.throws(() => parseReturnFiles([upload(name('02'), raw('02', '21'))], options('02')), { code: 'FILE_CHANNEL_MISMATCH' });
  const invalid = buildDataFile({ creator: '27', receiver: '306', date: '20260230', fileType: '02', records: [] });
  assert.throws(() => parseReturnFiles([upload(name('02', '20260230'), invalid)], options('02')), { code: 'INVALID_RETURN_DATE' });
  const other = buildDataFile({ creator: '27', receiver: '306', date: '20261008', fileType: '02', records: [] });
  assert.throws(() => parseReturnFiles([upload(name('02'), raw()), upload(name('02', '20261008'), other)], options('02')), { code: 'RETURN_PACKAGE_MISMATCH' });
});

test('rejects damaged records, count, names, numeric bytes, invalid encoding and truncated footer atomically', () => {
  const bytes = raw('04');
  const text = bytes.toString('latin1');
  for (const broken of [bytes.subarray(0, -1), Buffer.from(text.replace('0000000000000001', '0000000000000002'), 'latin1'),
    Buffer.from(text.replace('APPSHEETSERIALNO', 'BADFIELDNAME123'), 'latin1')]) {
    assert.throws(() => parseReturnFiles([upload(name('04'), broken)], options('04')), { code: 'INVALID_RETURN_FILE' });
  }
  const lines = text.split('\r\n');
  const fields = fieldsForFile('22', '04');
  const recordIndex = 11 + fields.length;
  const amountOffset = fields.slice(0, fields.findIndex(field => field.name === 'ConfirmedAmount')).reduce((sum, field) => sum + field.length, 0);
  lines[recordIndex] = lines[recordIndex].slice(0, amountOffset) + 'X' + lines[recordIndex].slice(amountOffset + 1);
  assert.throws(() => parseReturnFiles([upload(name('04'), Buffer.from(lines.join('\r\n'), 'latin1'))], options('04')), { code: 'INVALID_RETURN_FILE' });
  const bad = Buffer.from(raw());
  const chinese = bad.indexOf(Buffer.from('测试客户甲', 'utf8')); // encoding validation is checked on every byte, including headers
  assert.equal(chinese, -1);
  bad[0] = 0xff;
  assert.throws(() => parseReturnFiles([upload(name('02'), bad)], options('02')), { code: 'INVALID_RETURN_ENCODING' });
});

test('rejects unsafe names, duplicate names, malformed/noncanonical Base64 and resource excess', () => {
  const good = upload(name('02'), raw());
  for (const files of [[], [good, good], [{ ...good, fileName: '../x.TXT' }], [{ ...good, base64: '***=' }],
    [{ ...good, base64: 'AB==' }]]) assert.throws(() => parseReturnFiles(files, options('02')), { code: 'INVALID_RETURN_PACKAGE' });
  assert.throws(() => parseReturnFiles([upload(name('02'), Buffer.alloc(MAX_RETURN_BYTES + 1))], options('02')), { code: 'REQUEST_TOO_LARGE' });
  const many = buildDataFile({ creator: '27', receiver: '306', date: '20261007', fileType: '02', records: Array.from({ length: 2001 }, () => ({})) });
  assert.throws(() => parseReturnFiles([upload(name('02'), many)], options('02')), { code: 'RETURN_RECORD_LIMIT' });
});
