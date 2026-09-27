import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStorage, normalizeKey } from '../src/index.js';

test('normalizes OSS object keys', () => {
  assert.equal(normalizeKey('/factory/', '/sales-to-ta/', 'A.TXT'), 'factory/sales-to-ta/A.TXT');
});

test('stores a complete batch in the local artifact mirror', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fund-storage-'));
  const storage = new ArtifactStorage({ mode: 'local', localRoot: root, prefix: 'demo' });
  const result = await storage.putBatch('sales-to-ta/S1/20260920/BATCH0001', { 'A.TXT': Buffer.from('hello') });
  assert.equal(result.objects[0].key, 'demo/sales-to-ta/S1/20260920/BATCH0001/A.TXT');
  assert.equal(await fs.readFile(path.join(root, 'sales-to-ta/S1/20260920/BATCH0001/A.TXT'), 'utf8'), 'hello');
  await fs.rm(root, { recursive: true });
});
