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
  await client.post('/api/auth/register', { email: `analytics-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  return { client, book: await uploadRes.json() };
}

test('logging a reading session updates both per-book and overview analytics', async () => {
  const { client, book } = await newUserWithBook();

  const logRes = await client.post(`/api/books/${book.id}/reading-sessions`, {
    durationSeconds: 300,
    startProgress: 0,
    endProgress: 0.5,
  });
  assert.equal(logRes.status, 201);

  const bookStats = await (await client.get(`/api/books/${book.id}/analytics`)).json();
  assert.equal(bookStats.totalSeconds, 300);
  assert.equal(bookStats.sessionCount, 1);
  assert.equal(bookStats.maxProgress, 0.5);
  assert.ok(bookStats.pagesRead >= 0);

  const overview = await (await client.get('/api/analytics/overview')).json();
  assert.equal(overview.totalSeconds, 300);
  assert.equal(overview.sessionCount, 1);
  assert.equal(overview.booksRead, 1);
  assert.equal(overview.currentStreakDays, 1);
});

test('multiple sessions accumulate correctly and averages are computed', async () => {
  const { client, book } = await newUserWithBook();
  await client.post(`/api/books/${book.id}/reading-sessions`, { durationSeconds: 100, startProgress: 0, endProgress: 0.1 });
  await client.post(`/api/books/${book.id}/reading-sessions`, { durationSeconds: 200, startProgress: 0.1, endProgress: 0.2 });

  const bookStats = await (await client.get(`/api/books/${book.id}/analytics`)).json();
  assert.equal(bookStats.totalSeconds, 300);
  assert.equal(bookStats.sessionCount, 2);
  assert.equal(bookStats.avgSessionSeconds, 150);
  assert.equal(bookStats.maxProgress, 0.2);
});

test('rejects invalid session data', async () => {
  const { client, book } = await newUserWithBook();
  const res = await client.post(`/api/books/${book.id}/reading-sessions`, { durationSeconds: -5, startProgress: 0, endProgress: 1 });
  assert.equal(res.status, 400);
});

test('a user cannot log a session for or view analytics of another user\'s book', async () => {
  const owner = await newUserWithBook();
  const intruder = await newUserWithBook();
  assert.equal(
    (await intruder.client.post(`/api/books/${owner.book.id}/reading-sessions`, { durationSeconds: 10, startProgress: 0, endProgress: 0.1 })).status,
    404
  );
  assert.equal((await intruder.client.get(`/api/books/${owner.book.id}/analytics`)).status, 404);
});

test('a fresh user with no sessions gets zeroed-out overview stats, not an error', async () => {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: `analytics-empty-${randomUUID()}@example.com`, password: 'correct-horse' });
  const overview = await (await client.get('/api/analytics/overview')).json();
  assert.equal(overview.totalSeconds, 0);
  assert.equal(overview.sessionCount, 0);
  assert.equal(overview.currentStreakDays, 0);
});
