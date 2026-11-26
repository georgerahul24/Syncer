import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestClient } from '../test/helpers.js';

const { baseUrl } = await startTestServer();

async function newUser() {
  const client = new TestClient(baseUrl);
  await client.register();
  return client;
}

function uploadTxt(client: TestClient, content: string, filename = 'notes.txt') {
  return client.upload(content, filename, { type: 'text/plain' });
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
  const res = await client.upload(junk, 'mystery.bin');
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
  await other.register();
  const res = await other.put(`/api/books/${created.id}/content`, { content: 'hijacked' });
  assert.equal(res.status, 404, "another user's book must 404, not leak a 400");
});
