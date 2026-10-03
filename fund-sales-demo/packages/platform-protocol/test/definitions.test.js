import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_DEFINITIONS, FIELD_REQUIREMENTS, TRANSACTION_BUSINESSES,
  EXCHANGE_STREAMS, defaultExchangeStreamForFile, exchangeStream, indexKindFor
} from '../src/index.js';

test('the current TA file contract has complete, unambiguous field layouts', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(FILE_DEFINITIONS).map(([type, fields]) => [type, fields.length])),
    { '01': 89, '02': 27, '03': 82, '04': 122, '05': 23, '07': 86 }
  );
  for (const [type, fields] of Object.entries(FILE_DEFINITIONS)) {
    const names = fields.map(field => field.name);
    assert.equal(new Set(names).size, names.length, `${type} has duplicate fields`);
    for (const field of fields) {
      assert.ok(field.length > 0, `${type}.${field.name} has no width`);
      assert.ok(field.scale >= 0 && field.scale <= field.length, `${type}.${field.name} has an invalid scale`);
    }
  }
});

test('business requirements refer to fields in the corresponding files', () => {
  for (const type of ['01', '03', '04']) {
    const available = new Set(FILE_DEFINITIONS[type].map(field => field.name));
    const requirements = FIELD_REQUIREMENTS[type];
    for (const name of requirements.required) assert.ok(available.has(name), `${type}.${name}`);
    for (const names of Object.values(requirements.requiredByBusiness)) {
      for (const name of names) assert.ok(available.has(name), `${type}.${name}`);
    }
  }
  for (const [code, business] of Object.entries(TRANSACTION_BUSINESSES)) {
    assert.deepEqual(FIELD_REQUIREMENTS['03'].requiredByBusiness[code], business.required03);
    if (business.confirmationCode) {
      assert.deepEqual(FIELD_REQUIREMENTS['04'].requiredByBusiness[business.confirmationCode], business.required04);
    }
  }
});

test('outbound and return files have explicit exchange directions', () => {
  assert.equal(defaultExchangeStreamForFile('01').direction, 'sales-to-ta');
  assert.equal(defaultExchangeStreamForFile('03').direction, 'sales-to-ta');
  for (const type of ['02', '04', '05']) {
    assert.equal(defaultExchangeStreamForFile(type).direction, 'ta-to-sales');
  }
  assert.equal(EXCHANGE_STREAMS.taEarlyConfirmation.indexKind, 'OFF');
  assert.equal(defaultExchangeStreamForFile('04').id, 'taConfirmation');
});

test('explicit exchange streams reject unsupported file types and inherited names', () => {
  assert.equal(indexKindFor({ streamId: 'taEarlyConfirmation', fileType: '04' }), 'OFF');
  assert.equal(indexKindFor({ streamId: 'taConfirmation', fileType: '04' }), 'OFI');
  assert.throws(() => indexKindFor({ streamId: 'taEarlyConfirmation', fileType: '01' }), /not supported/);
  assert.throws(() => indexKindFor({ streamId: 'salesApplication', fileType: '04' }), /not supported/);
  assert.throws(() => exchangeStream('toString'), /Unsupported exchange stream/);
});
