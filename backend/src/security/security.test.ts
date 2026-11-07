import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = path.join(os.tmpdir(), `syncer-test-${randomUUID()}`);

const { createApp } = await import('../app.js');
const { listen, TestClient } = await import('../test/helpers.js');

const { baseUrl, server } = await listen(createApp());
test.after(() => server.close());

test('another website cannot call the API', async () => {
  const client = new TestClient(baseUrl);
  const res = await client.request('GET', '/api/health', undefined, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('the native apps and same-origin pages can', async () => {
  const client = new TestClient(baseUrl);
  for (const origin of ['tauri://localhost', 'http://tauri.localhost', baseUrl]) {
    const res = await client.request('GET', '/api/health', undefined, { Origin: origin });
    assert.equal(res.status, 200, origin);
  }
  const native = await client.request('GET', '/api/health', undefined, { Origin: 'tauri://localhost' });
  assert.equal(native.headers.get('access-control-allow-origin'), 'tauri://localhost');
});

test('responses carry the hardening headers', async () => {
  const res = await new TestClient(baseUrl).get('/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});
