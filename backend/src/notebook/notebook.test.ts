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
  await client.post('/api/auth/register', { email: `nb-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  return { client, book: await uploadRes.json() };
}

test('create, list, edit, and delete a notebook page', async () => {
  const { client, book } = await newUserWithBook();

  const createRes = await client.post(`/api/books/${book.id}/notebook-pages`, { afterPage: 1 });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.deepEqual(created.location, { afterPage: 1 });
  assert.equal(created.text, '');
  assert.deepEqual(created.strokes, []);

  const list = await (await client.get(`/api/books/${book.id}/notebook-pages`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  const strokes = [{ color: '#000', width: 2, points: [{ x: 0, y: 0, pressure: 1 }] }];
  const updateRes = await client.put(`/api/notebook-pages/${created.id}`, { text: 'hello', strokes });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.text, 'hello');
  assert.deepEqual(updated.strokes, strokes);

  const deleteRes = await client.delete(`/api/notebook-pages/${created.id}`);
  assert.equal(deleteRes.status, 204);
  const listAfter = await (await client.get(`/api/books/${book.id}/notebook-pages`)).json();
  assert.equal(listAfter.length, 0);
});

test('rejects an invalid afterPage', async () => {
  const { client, book } = await newUserWithBook();
  const res = await client.post(`/api/books/${book.id}/notebook-pages`, { afterPage: -1 });
  assert.equal(res.status, 400);
});

test('a user cannot read, edit, or delete another user\'s notebook page', async () => {
  const { client: ownerClient, book } = await newUserWithBook();
  const created = await (await ownerClient.post(`/api/books/${book.id}/notebook-pages`, { afterPage: 0 })).json();

  const otherClient = new TestClient(baseUrl);
  await otherClient.post('/api/auth/register', { email: `nb-other-${randomUUID()}@example.com`, password: 'correct-horse' });

  assert.equal((await otherClient.get(`/api/books/${book.id}/notebook-pages`)).status, 404);
  assert.equal((await otherClient.put(`/api/notebook-pages/${created.id}`, { text: 'x' })).status, 404);
  assert.equal((await otherClient.delete(`/api/notebook-pages/${created.id}`)).status, 404);
});
