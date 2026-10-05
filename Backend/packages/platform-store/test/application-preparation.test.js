import assert from 'node:assert/strict';
import test from 'node:test';
import { boundPreparationHistory } from '../src/application-preparation.js';

test('history retention preserves frozen applications and files when the full state is near its byte limit', () => {
  const intents = [{ key: 'open1', fields: { CertificateNo: 'TESTCERT1' },
    material: '资'.repeat(55000) }];
  const files = [{ id: '7', sha256: 'a'.repeat(64) }];
  const state = { intents, files, stagedKeys: ['open1'], revision: 9,
    turns: Array.from({ length: 10 }, (_, i) => ({ userInput: `${i}` + '资'.repeat(3998),
      reply: '补'.repeat(4000) })) };
  const bounded = boundPreparationHistory(state);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 240000);
  assert.ok(bounded.turnsOmitted > 0);
  assert.deepEqual(bounded.intents, intents);
  assert.deepEqual(bounded.files, files);
  assert.deepEqual(bounded.stagedKeys, ['open1']);
  assert.equal(bounded.revision, 9);
  assert.match(bounded.turns.at(-1).userInput, /^9/);
  assert.equal(state.turns.length, 10);
  assert.deepEqual(boundPreparationHistory(bounded), bounded);
});

test('short histories are bounded by turn count and accumulate the omitted count', () => {
  const turns = Array.from({ length: 50 }, (_, i) => ({ userInput: String(i), reply: '待补充' }));
  const bounded = boundPreparationHistory({ turns, turnsOmitted: 4, intents: [], files: [] });
  assert.equal(bounded.turnsOmitted + bounded.turns.length, 54);
  assert.ok(bounded.turns.length <= 20);
  assert.equal(bounded.turns.at(-1).userInput, '49');
});

test('oversized non-history data is rejected without dropping frozen applications or the latest turn', () => {
  const state = { turns: [{ userInput: '补齐', reply: '保留' }],
    intents: [{ key: 'open1', material: '资'.repeat(81000) }], stagedKeys: ['open1'], files: [] };
  assert.throws(() => boundPreparationHistory(state), { code: 'INVALID_INPUT', status: 400 });
  assert.equal(state.turns.length, 1);
  assert.equal(state.intents[0].material.length, 81000);
});
