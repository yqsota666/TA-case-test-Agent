import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPlatformApp } from '../services/sales/src/platform/http-app.js';

test('legacy API serves health and rejects unauthenticated and cross-origin requests', async () => {
  const queries = [];
  const app = createPlatformApp({ transaction: async action => action({ execute: async sql => {
    queries.push(sql);
    assert.equal(sql, 'SELECT 1');
    return [[{ '1': 1 }]];
  } }) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const chats = await fetch(base + '/api/v2/chats');
    assert.equal(chats.status, 401);
    assert.equal((await chats.json()).code, 'UNAUTHENTICATED');
    const crossOrigin = await fetch(base + '/api/auth/demo', { method: 'POST',
      headers: { origin: 'http://foreign.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).code, 'CROSS_ORIGIN');
    assert.deepEqual(queries, ['SELECT 1']);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
