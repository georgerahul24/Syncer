import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Must run before any import that transitively touches config/db (they read
// DATA_DIR at module-evaluation time). Static imports are hoisted above
// top-level code in ESM, so those modules are loaded dynamically below,
// after this assignment actually executes.
process.env.DATA_DIR = path.join(os.tmpdir(), `syncer-test-${randomUUID()}`);

const { createApp } = await import('../app.js');
const { listen, TestClient } = await import('../test/helpers.js');

const { baseUrl, server } = await listen(createApp());
test.after(() => server.close());

test('register creates an account and sets a session cookie', async () => {
  const client = new TestClient(baseUrl);
  const res = await client.post('/api/auth/register', { email: 'reader@example.com', password: 'correct-horse' });
  assert.equal(res.status, 201);
  assert.ok(client.cookieHeader, 'expected a session cookie to be set');
});

test('register rejects a weak password and an invalid email', async () => {
  const client = new TestClient(baseUrl);
  const weak = await client.post('/api/auth/register', { email: 'weak@example.com', password: '123' });
  assert.equal(weak.status, 400);
  const badEmail = await client.post('/api/auth/register', { email: 'not-an-email', password: 'correct-horse' });
  assert.equal(badEmail.status, 400);
});

test('register rejects a duplicate email', async () => {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: 'dup@example.com', password: 'correct-horse' });
  const second = await client.post('/api/auth/register', { email: 'dup@example.com', password: 'correct-horse' });
  assert.equal(second.status, 409);
});

test('login succeeds with correct credentials and fails with wrong password', async () => {
  const setup = new TestClient(baseUrl);
  await setup.post('/api/auth/register', { email: 'login@example.com', password: 'correct-horse' });

  const client = new TestClient(baseUrl);
  const bad = await client.post('/api/auth/login', { email: 'login@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);

  const good = await client.post('/api/auth/login', { email: 'login@example.com', password: 'correct-horse' });
  assert.equal(good.status, 200);
  assert.ok(client.cookieHeader);
});

test('me requires authentication', async () => {
  const client = new TestClient(baseUrl);
  const res = await client.get('/api/auth/me');
  assert.equal(res.status, 401);
});

test('logout clears the session so subsequent requests are unauthenticated', async () => {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: 'logout@example.com', password: 'correct-horse' });
  assert.equal((await client.get('/api/auth/me')).status, 200);

  await client.post('/api/auth/logout');
  const after = await client.get('/api/auth/me');
  assert.equal(after.status, 401);
});

test('repeated failed logins against one account are eventually rate-limited', async () => {
  const email = 'bruteforce@example.com';
  const setup = new TestClient(baseUrl);
  await setup.post('/api/auth/register', { email, password: 'correct-horse' });

  const client = new TestClient(baseUrl);
  let sawTooMany = false;
  for (let i = 0; i < 15; i++) {
    const res = await client.post('/api/auth/login', { email, password: 'wrong-password' });
    if (res.status === 429) {
      sawTooMany = true;
      break;
    }
    assert.equal(res.status, 401);
  }
  assert.ok(sawTooMany, 'expected a 429 after repeated failed attempts against the same account');

  // A different account, from the same test client/IP, must be unaffected.
  const other = new TestClient(baseUrl);
  await setup.post('/api/auth/register', { email: 'unrelated@example.com', password: 'correct-horse' });
  const stillWorks = await other.post('/api/auth/login', { email: 'unrelated@example.com', password: 'correct-horse' });
  assert.equal(stillWorks.status, 200);
});
