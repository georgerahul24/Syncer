import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, newUserWithBook, pdfBytes } from '../test/helpers.js';

const { baseUrl } = await startTestServer();

test('tagging a book creates the tag, lists it on the book, and finds it by filter', async () => {
  const { client, book } = await newUserWithBook(baseUrl);

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
  const { client, book } = await newUserWithBook(baseUrl);
  await client.post(`/api/books/${book.id}/tags`, { name: 'Fiction' });
  await client.post(`/api/books/${book.id}/tags`, { name: 'fiction' }); // same tag, different case

  const allTags = await (await client.get('/api/tags')).json();
  assert.equal(allTags.length, 1);

  const fetched = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(fetched.tags.length, 1);
});

test('removing a tag from one book does not delete the tag or affect other books using it', async () => {
  const { client, book } = await newUserWithBook(baseUrl);
  const book2 = await (await client.upload(pdfBytes, 'book2.pdf')).json();

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
  const { client, book } = await newUserWithBook(baseUrl);
  const tag = await (await client.post(`/api/books/${book.id}/tags`, { name: 'Temp' })).json();
  assert.equal((await client.delete(`/api/tags/${tag.id}`)).status, 204);
  const fetched = await (await client.get(`/api/books/${book.id}`)).json();
  assert.equal(fetched.tags.length, 0);
});

test('a user cannot tag another user\'s book or delete another user\'s tag', async () => {
  const owner = await newUserWithBook(baseUrl);
  const intruder = await newUserWithBook(baseUrl);

  assert.equal((await intruder.client.post(`/api/books/${owner.book.id}/tags`, { name: 'x' })).status, 404);

  const ownerTag = await (await owner.client.post(`/api/books/${owner.book.id}/tags`, { name: 'Mine' })).json();
  assert.equal((await intruder.client.delete(`/api/tags/${ownerTag.id}`)).status, 404);
  assert.equal((await intruder.client.delete(`/api/books/${owner.book.id}/tags/${ownerTag.id}`)).status, 404);
});
