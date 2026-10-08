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
  await client.post('/api/auth/register', { email: `ann-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  return { client, book: await uploadRes.json() };
}

test('create, list, edit, and delete an annotation', async () => {
  const { client, book } = await newUserWithBook();

  const createRes = await client.post(`/api/books/${book.id}/annotations`, {
    type: 'highlight',
    color: 'green',
    locationType: 'pdf',
    location: { page: 3, rects: [{ x: 0, y: 0, w: 10, h: 10 }] },
    selectedText: 'an important sentence',
    note: 'why this matters',
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.color, 'green');
  assert.equal(created.selectedText, 'an important sentence');

  const list = await (await client.get(`/api/books/${book.id}/annotations`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  const updateRes = await client.put(`/api/annotations/${created.id}`, { color: 'pink', note: 'updated note' });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.color, 'pink');
  assert.equal(updated.note, 'updated note');
  // location/selectedText must survive an edit untouched
  assert.equal(updated.selectedText, 'an important sentence');

  const deleteRes = await client.delete(`/api/annotations/${created.id}`);
  assert.equal(deleteRes.status, 204);
  const afterDelete = await (await client.get(`/api/books/${book.id}/annotations`)).json();
  assert.equal(afterDelete.length, 0);
});

test('annotations persist independently of screen/zoom by storing opaque location data', async () => {
  const { client, book } = await newUserWithBook();
  const res = await client.post(`/api/books/${book.id}/annotations`, {
    type: 'note',
    locationType: 'pdf',
    location: { page: 1, contextBefore: 'a', contextAfter: 'b', normalized: { x: 0.5, y: 0.2 } },
    note: 'stable across zoom',
  });
  const created = await res.json();
  const refetched = await (await client.get(`/api/books/${book.id}/annotations`)).json();
  assert.deepEqual(refetched[0].location, created.location);
});

test('a user cannot read, edit, or delete another user\'s annotation', async () => {
  const owner = await newUserWithBook();
  const intruderClient = new TestClient(baseUrl);
  await intruderClient.post('/api/auth/register', { email: `intruder-${randomUUID()}@example.com`, password: 'correct-horse' });

  const createRes = await owner.client.post(`/api/books/${owner.book.id}/annotations`, {
    type: 'highlight',
    locationType: 'pdf',
    location: { page: 1 },
    selectedText: 'secret',
  });
  const annotation = await createRes.json();

  assert.equal((await intruderClient.get(`/api/books/${owner.book.id}/annotations`)).status, 404);
  assert.equal((await intruderClient.put(`/api/annotations/${annotation.id}`, { color: 'blue' })).status, 404);
  assert.equal((await intruderClient.delete(`/api/annotations/${annotation.id}`)).status, 404);
});

test('rejects an invalid annotation type', async () => {
  const { client, book } = await newUserWithBook();
  const res = await client.post(`/api/books/${book.id}/annotations`, {
    type: 'bogus',
    locationType: 'pdf',
    location: { page: 1 },
  });
  assert.equal(res.status, 400);
});
