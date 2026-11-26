import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestClient, newUserWithBook } from '../test/helpers.js';

const { baseUrl } = await startTestServer();

// Upload-time indexing is fire-and-forget (see search/README.md) so it
// isn't guaranteed done by the time the upload response returns — poll.
async function waitForIndex(client: InstanceType<typeof TestClient>, query: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await client.get(`/api/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();
    if (results.some((r: any) => r.kind === 'text')) return results;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for "${query}" to be indexed`);
}

test('finds document text across the library, scoped to the owner', async () => {
  const { client, book } = await newUserWithBook(baseUrl);
  const results = await waitForIndex(client, 'Test');
  const hit = results.find((r: any) => r.kind === 'text' && r.bookId === book.id);
  assert.ok(hit, 'expected a text match for the uploaded book');
  assert.equal(hit.locationType, 'pdf-page');
  assert.equal(hit.location.page, 1);

  const other = new TestClient(baseUrl);
  await other.register();
  const otherResults = await (await other.get('/api/search?q=Test')).json();
  assert.equal(otherResults.some((r: any) => r.bookId === book.id), false, "must not see another user's book text");
});

test('finds annotations (notes and highlighted text) across the library', async () => {
  const { client, book } = await newUserWithBook(baseUrl);
  await client.post(`/api/books/${book.id}/annotations`, {
    type: 'note',
    color: 'yellow',
    locationType: 'pdf',
    location: { page: 1, rects: [] },
    note: 'remember this specific phrase',
  });
  const results = await (await client.get('/api/search?q=specific+phrase')).json();
  const hit = results.find((r: any) => r.kind === 'annotation');
  assert.ok(hit, 'expected an annotation match');
  assert.equal(hit.bookId, book.id);
  assert.equal(hit.annotationId !== undefined, true);
});

test('finds books by title', async () => {
  const { client, book } = await newUserWithBook(baseUrl);
  const results = await (await client.get(`/api/search?q=${encodeURIComponent(book.title)}`)).json();
  assert.ok(results.some((r: any) => r.kind === 'book' && r.bookId === book.id));
});

test('rejects a too-short query with an empty result rather than erroring', async () => {
  const { client } = await newUserWithBook(baseUrl);
  const res = await client.get('/api/search?q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('a deleted book\'s text index is removed too', async () => {
  const { client, book } = await newUserWithBook(baseUrl);
  await waitForIndex(client, 'Test');
  await client.delete(`/api/books/${book.id}`);
  const results = await (await client.get('/api/search?q=Test')).json();
  assert.equal(results.some((r: any) => r.bookId === book.id), false);
});
