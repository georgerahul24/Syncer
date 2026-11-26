import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestClient, pdfBytes } from '../test/helpers.js';

const { baseUrl } = await startTestServer();
const share = { urlPath: '/share-target', redirect: 'manual' } as const;

test('an unauthenticated share-target POST redirects to login instead of returning raw JSON', async () => {
  const res = await new TestClient(baseUrl).upload(pdfBytes, 'shared.pdf', share);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('sharing a PDF creates the book and redirects straight to its reader page', async () => {
  const client = new TestClient(baseUrl);
  await client.register();

  const res = await client.upload(pdfBytes, 'shared.pdf', share);
  assert.equal(res.status, 302);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/book\/[0-9a-f-]+$/);

  const bookId = location.split('/').pop();
  const book = await (await client.get(`/api/books/${bookId}`)).json();
  assert.equal(book.title, 'Test PDF');
});

test('sharing an invalid file redirects back to the library with an error message', async () => {
  // See the equivalent comment in books/books.test.ts — plain readable text
  // is now legitimately accepted as a .txt book, so this needs genuine
  // binary garbage to still be an "invalid file" case.
  const client = new TestClient(baseUrl);
  await client.register();

  const res = await client.upload(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x00, 0x00]), 'shared.pdf', share);
  assert.equal(res.status, 302);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/\?error=/);
});
