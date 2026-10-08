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

async function newUserWithBook() {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: `folders-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  return { client, book: await uploadRes.json() };
}

test('create a folder, move a book into it, and list books filtered by folder', async () => {
  const { client, book } = await newUserWithBook();

  const createRes = await client.post('/api/folders', { name: 'Textbooks' });
  assert.equal(createRes.status, 201);
  const folder = await createRes.json();
  assert.equal(folder.name, 'Textbooks');
  assert.equal(folder.bookCount, 0);

  const moveRes = await client.put(`/api/books/${book.id}/folder`, { folderId: folder.id });
  assert.equal(moveRes.status, 200);

  const inFolder = await (await client.get(`/api/books?folderId=${folder.id}`)).json();
  assert.equal(inFolder.length, 1);
  assert.equal(inFolder[0].id, book.id);
  assert.equal(inFolder[0].folderId, folder.id);

  const unfiled = await (await client.get(`/api/books?folderId=none`)).json();
  assert.equal(unfiled.length, 0);

  const list = await (await client.get('/api/folders')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].bookCount, 1);
});

test('deleting a folder unfiles its books instead of deleting them', async () => {
  const { client, book } = await newUserWithBook();
  const folder = await (await client.post('/api/folders', { name: 'Temp' })).json();
  await client.put(`/api/books/${book.id}/folder`, { folderId: folder.id });

  assert.equal((await client.delete(`/api/folders/${folder.id}`)).status, 204);

  const stillThere = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(stillThere.folderId, null);
});

test('a user cannot move a book into another user\'s folder, or manage another user\'s folder', async () => {
  const owner = await newUserWithBook();
  const intruder = await newUserWithBook();
  const ownerFolder = await (await owner.client.post('/api/folders', { name: 'Mine' })).json();

  const res = await intruder.client.put(`/api/books/${intruder.book.id}/folder`, { folderId: ownerFolder.id });
  assert.equal(res.status, 404);

  assert.equal((await intruder.client.put(`/api/folders/${ownerFolder.id}`, { name: 'Hijacked' })).status, 404);
  assert.equal((await intruder.client.delete(`/api/folders/${ownerFolder.id}`)).status, 404);
});

test('rejects an empty folder name', async () => {
  const { client } = await newUserWithBook();
  const res = await client.post('/api/folders', { name: '   ' });
  assert.equal(res.status, 400);
});
