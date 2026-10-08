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
  await client.post('/api/auth/register', { email: `tags-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  return { client, book: await uploadRes.json() };
}

test('tagging a book creates the tag, lists it on the book, and finds it by filter', async () => {
  const { client, book } = await newUserWithBook();

  const tagRes = await client.post(`/api/books/${book.id}/tags`, { name: 'Machine Learning' });
  assert.equal(tagRes.status, 201);
  const tag = await tagRes.json();
  assert.equal(tag.name, 'Machine Learning');

  const fetched = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(fetched.tags.length, 1);
  assert.equal(fetched.tags[0].name, 'Machine Learning');

  const filtered = await (await client.get('/api/books?tag=Machine%20Learning')).json();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, book.id);

  const allTags = await (await client.get('/api/tags')).json();
  assert.equal(allTags.length, 1);
  assert.equal(allTags[0].bookCount, 1);
});

test('tagging with the same name (case-insensitive) reuses the existing tag rather than duplicating it', async () => {
  const { client, book } = await newUserWithBook();
  await client.post(`/api/books/${book.id}/tags`, { name: 'Fiction' });
  await client.post(`/api/books/${book.id}/tags`, { name: 'fiction' }); // same tag, different case

  const allTags = await (await client.get('/api/tags')).json();
  assert.equal(allTags.length, 1);

  const fetched = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(fetched.tags.length, 1);
});

test('removing a tag from one book does not delete the tag or affect other books using it', async () => {
  const { client, book } = await newUserWithBook();
  const { book: book2 } = await (async () => {
    const form = new FormData();
    form.append('file', new Blob([pdfBytes]), 'book2.pdf');
    const res = await fetch(`${baseUrl}/api/books`, { method: 'POST', headers: { Cookie: client.cookieHeader! }, body: form });
    return { book: await res.json() };
  })();

  const tag = await (await client.post(`/api/books/${book.id}/tags`, { name: 'Shared' })).json();
  await client.post(`/api/books/${book2.id}/tags`, { name: 'Shared' });

  assert.equal((await client.delete(`/api/books/${book.id}/tags/${tag.id}`)).status, 204);

  const b1 = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(b1.tags.length, 0);
  const b2 = await (await client.get(`/api/books/${book2.id}`)).json();
  assert.equal(b2.tags.length, 1);

  const allTags = await (await client.get('/api/tags')).json();
  assert.equal(allTags.length, 1, 'the tag itself must still exist since book2 still uses it');
});

test('deleting a tag removes it from every book that had it', async () => {
  const { client, book } = await newUserWithBook();
  const tag = await (await client.post(`/api/books/${book.id}/tags`, { name: 'Temp' })).json();
  assert.equal((await client.delete(`/api/tags/${tag.id}`)).status, 204);
  const fetched = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(fetched.tags.length, 0);
});

test('a user cannot tag another user\'s book or delete another user\'s tag', async () => {
  const owner = await newUserWithBook();
  const intruder = await newUserWithBook();

  assert.equal((await intruder.client.post(`/api/books/${owner.book.id}/tags`, { name: 'x' })).status, 404);

  const ownerTag = await (await owner.client.post(`/api/books/${owner.book.id}/tags`, { name: 'Mine' })).json();
  assert.equal((await intruder.client.delete(`/api/tags/${ownerTag.id}`)).status, 404);
  assert.equal((await intruder.client.delete(`/api/books/${owner.book.id}/tags/${ownerTag.id}`)).status, 404);
});
