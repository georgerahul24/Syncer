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

async function newUser() {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: `txt-${randomUUID()}@example.com`, password: 'correct-horse' });
  return client;
}

async function uploadTxt(client: InstanceType<typeof TestClient>, content: string, filename = 'notes.txt') {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  const res = await fetch(`${baseUrl}/api/books`, { method: 'POST', headers: { Cookie: client.cookieHeader! }, body: form });
  return res;
}

test('uploads a .txt file, defaulting the title to the filename', async () => {
  const client = await newUser();
  const res = await uploadTxt(client, 'Hello, this is my note.\nSecond line.');
  assert.equal(res.status, 201);
  const book = await res.json();
  assert.equal(book.format, 'txt');
  assert.equal(book.title, 'notes');
  assert.equal(book.pageCount, null);

  const fileRes = await client.get(`/api/books/${book.id}/file`);
  assert.equal(await fileRes.text(), 'Hello, this is my note.\nSecond line.');
});

test('rejects a binary file even without a recognized magic number', async () => {
  const client = await newUser();
  const junk = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x00, 0x00]);
  const form = new FormData();
  form.append('file', new Blob([junk]), 'mystery.bin');
  const res = await fetch(`${baseUrl}/api/books`, { method: 'POST', headers: { Cookie: client.cookieHeader! }, body: form });
  assert.equal(res.status, 400);
});

test('live-edits a .txt book\'s content, persists it, and re-indexes it for search', async () => {
  const client = await newUser();
  const created = await (await uploadTxt(client, 'original content about apples')).json();

  const updateRes = await client.put(`/api/books/${created.id}/content`, { content: 'updated content about oranges' });
  assert.equal(updateRes.status, 204);

  const fileRes = await client.get(`/api/books/${created.id}/file`);
  assert.equal(await fileRes.text(), 'updated content about oranges');

  const results = await (await client.get('/api/search?q=oranges')).json();
  assert.ok(results.some((r: any) => r.bookId === created.id && r.kind === 'text'));
  const stale = await (await client.get('/api/search?q=apples')).json();
  assert.equal(stale.some((r: any) => r.bookId === created.id), false, 'old content must not still be indexed');
});

test('a non-txt book cannot be edited via the content endpoint', async () => {
  const client = await newUser();
  const created = await (await uploadTxt(client, 'x')).json();
  const other = new TestClient(baseUrl);
  await other.post('/api/auth/register', { email: `txt-other-${randomUUID()}@example.com`, password: 'correct-horse' });
  const res = await other.put(`/api/books/${created.id}/content`, { content: 'hijacked' });
  assert.equal(res.status, 404, "another user's book must 404, not leak a 400");
});
