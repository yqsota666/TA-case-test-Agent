import assert from 'node:assert/strict';
import test from 'node:test';
import { createReturnParsingGraph } from '../src/return-parsing-graph.js';
import { buildDataFile } from '../../platform-protocol/src/index.js';
const channel = { taCode: '27', distributorCode: '306', protocolVersion: '22' };
const upload = type => [{ fileName: `OFD_27_306_20261007_${type}_001.TXT`, base64: buildDataFile({ creator: '27',
  receiver: '306', date: '20261007', fileType: type, records: [{ ReturnCode: '0000' }] }).toString('base64') }];

test('01→wait02 and 03→wait04 are separate graph routes, including direct03 without01', async () => {
  const graph = createReturnParsingGraph({ channel });
  assert.deepEqual(Object.keys(graph.getGraph().nodes).filter(name => !name.startsWith('__')).sort(),
    ['parse_account_return', 'parse_transaction_return', 'wait_account_return', 'wait_transaction_return']);
  for (const expectedType of ['02', '04']) {
    const waiting = await graph.invoke({ expectedType });
    assert.equal(waiting.phase, 'WAITING_UPLOAD'); assert.equal(waiting.parsed, null);
    const parsed = await graph.invoke({ expectedType, files: upload(expectedType) });
    assert.equal(parsed.phase, 'PARSED'); assert.equal(parsed.parsed.result.expectedType, expectedType);
    assert.equal(parsed.parsed.result.businessApplied, false);
  }
});

test('invalid upload never reaches PARSED; a subsequent valid upload can retry', async () => {
  const graph = createReturnParsingGraph({ channel });
  await assert.rejects(graph.invoke({ expectedType: '04', files: upload('02') }), { code: 'RETURN_TYPE_MISMATCH' });
  assert.equal((await graph.invoke({ expectedType: '04' })).phase, 'WAITING_UPLOAD');
  assert.equal((await graph.invoke({ expectedType: '04', files: upload('04') })).phase, 'PARSED');
});
