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
const epubBytes = fs.readFileSync(path.join(fixturesDir, 'sample.epub'));

async function newUser(email: string) {
  const client = new TestClient(baseUrl);
  const res = await client.post('/api/auth/register', { email, password: 'correct-horse' });
  const user = await res.json();
  return { client, user };
}

function uploadForm(bytes: Buffer, filename: string) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  return form;
}

test('uploading a PDF stores it, extracts metadata, and lists it in the library', async () => {
  const { client } = await newUser(`pdf-${randomUUID()}@example.com`);
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: uploadForm(pdfBytes, 'book.pdf'),
  });
  assert.equal(uploadRes.status, 201);
  const book = await uploadRes.json();
  assert.equal(book.format, 'pdf');
  assert.equal(book.title, 'Test PDF');
  assert.equal(book.author, 'Ada Lovelace');
  assert.equal(book.pageCount, 1);

  const list = await (await client.get('/api/books')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, book.id);
});

test('uploading an EPUB stores it and extracts title/author', async () => {
  const { client } = await newUser(`epub-${randomUUID()}@example.com`);
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: uploadForm(epubBytes, 'book.epub'),
  });
  assert.equal(uploadRes.status, 201);
  const book = await uploadRes.json();
  assert.equal(book.format, 'epub');
  assert.equal(book.title, 'Test Book');
  assert.equal(book.identifier, 'urn:uuid:test-123');
});

test('rejects a file that is not actually a PDF or EPUB despite its extension', async () => {
  // Plain readable text despite the .pdf name is now legitimately accepted
  // as a .txt book (see books/txt.test.ts) — genuine binary garbage (a NUL
  // byte makes it unambiguous) is what should still be rejected outright.
  const { client } = await newUser(`fake-${randomUUID()}@example.com`);
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: uploadForm(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x00, 0x00]), 'book.pdf'),
  });
  assert.equal(uploadRes.status, 400);
});

test('upload requires authentication', async () => {
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    body: uploadForm(pdfBytes, 'book.pdf'),
  });
  assert.equal(uploadRes.status, 401);
});

test('a user cannot access, download, or delete another user\'s book by ID', async () => {
  const owner = await newUser(`owner-${randomUUID()}@example.com`);
  const intruder = await newUser(`intruder-${randomUUID()}@example.com`);

  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: owner.client.cookieHeader! },
    body: uploadForm(pdfBytes, 'book.pdf'),
  });
  const book = await uploadRes.json();

  assert.equal((await intruder.client.get(`/api/books/${book.id}`)).status, 404);
  assert.equal((await intruder.client.get(`/api/books/${book.id}/file`)).status, 404);
  assert.equal((await intruder.client.delete(`/api/books/${book.id}`)).status, 404);

  // owner still has it
  assert.equal((await owner.client.get(`/api/books/${book.id}`)).status, 200);
});

test('deleting a book removes it from the library and from disk', async () => {
  const { client } = await newUser(`delete-${randomUUID()}@example.com`);
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: uploadForm(pdfBytes, 'book.pdf'),
  });
  const book = await uploadRes.json();

  assert.equal((await client.delete(`/api/books/${book.id}`)).status, 204);
  assert.equal((await client.get(`/api/books/${book.id}`)).status, 404);

  const libraryDir = path.join(process.env.DATA_DIR!, 'library');
  const bookDirStillExists =
    fs.existsSync(libraryDir) &&
    fs.readdirSync(libraryDir, { recursive: true } as any).some((f) => String(f).includes(book.id));
  assert.equal(bookDirStillExists, false);
});
