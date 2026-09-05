import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = path.join(os.tmpdir(), `syncer-test-${randomUUID()}`);

const { createApp } = await import('../app.js');
const { listen, TestClient } = await import('../test/helpers.js');

const { baseUrl, server } = await listen(createApp());
test.after(() => server.close());

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const pdfBytes = fs.readFileSync(path.join(fixturesDir, 'sample.pdf'));

test('an unauthenticated share-target POST redirects to login instead of returning raw JSON', async () => {
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'shared.pdf');
  const res = await fetch(`${baseUrl}/share-target`, { method: 'POST', body: form, redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('sharing a PDF creates the book and redirects straight to its reader page', async () => {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: `share-${randomUUID()}@example.com`, password: 'correct-horse' });

  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'shared.pdf');
  const res = await fetch(`${baseUrl}/share-target`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
    redirect: 'manual',
  });
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
  await client.post('/api/auth/register', { email: `share-bad-${randomUUID()}@example.com`, password: 'correct-horse' });

  const form = new FormData();
  form.append('file', new Blob([Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x00, 0x00])]), 'shared.pdf');
  const res = await fetch(`${baseUrl}/share-target`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/\?error=/);
});
