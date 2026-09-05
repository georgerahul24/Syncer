import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.DATA_DIR = path.join(os.tmpdir(), `syncer-test-${randomUUID()}`);

const { createApp } = await import('../app.js');
const { attachWebSocketServer } = await import('../websocket/server.js');
const { listen, TestClient } = await import('../test/helpers.js');

const { baseUrl, server } = await listen(createApp());
const wss = attachWebSocketServer(server);
const wsBaseUrl = baseUrl.replace('http', 'ws');
test.after(() => {
  // Force-close everything rather than waiting for graceful close
  // handshakes — a failed assertion earlier in the file can otherwise skip
  // a test's own `ws.close()` and leave a handle open forever.
  for (const client of wss.clients) client.terminate();
  server.closeAllConnections?.();
  server.close();
});

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const pdfBytes = fs.readFileSync(path.join(fixturesDir, 'sample.pdf'));

async function newUserWithBook() {
  const client = new TestClient(baseUrl);
  await client.post('/api/auth/register', { email: `sync-${randomUUID()}@example.com`, password: 'correct-horse' });
  const form = new FormData();
  form.append('file', new Blob([pdfBytes]), 'book.pdf');
  const uploadRes = await fetch(`${baseUrl}/api/books`, {
    method: 'POST',
    headers: { Cookie: client.cookieHeader! },
    body: form,
  });
  const book = await uploadRes.json();
  return { client, book };
}

// The `ws` client can emit 'open' and the first 'message' synchronously
// within the same tick (e.g. when the server's handshake response and its
// first frame land in one TCP read). Attaching a 'message' listener only
// *after* awaiting connect() can therefore miss a message that arrives
// immediately (like our `joined` message, sent the instant the server
// accepts the connection). To make that structurally impossible, every
// socket gets a single buffering listener from the moment it's created;
// nextMessage() drains that buffer instead of racing a fresh listener.
const buffers = new WeakMap<WebSocket, any[]>();
const waiters = new WeakMap<WebSocket, Array<() => void>>();

function connect(cookie: string, bookId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws?bookId=${bookId}`, { headers: { Cookie: cookie } });
    buffers.set(ws, []);
    waiters.set(ws, []);
    ws.on('message', (raw: Buffer) => {
      buffers.get(ws)!.push(JSON.parse(raw.toString()));
      for (const wake of waiters.get(ws)!.splice(0)) wake();
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    // The `ws` client emits this (not 'error') when the server refuses the
    // upgrade with a plain HTTP status, which is exactly what our server
    // does for an invalid session cookie or an unowned/missing book.
    ws.once('unexpected-response', (_req, res) => reject(new Error(`Unexpected server response: ${res.statusCode}`)));
  });
}

async function nextMessage(ws: WebSocket, predicate?: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const buf = buffers.get(ws)!;
    const idx = buf.findIndex((m) => !predicate || predicate(m));
    if (idx !== -1) return buf.splice(idx, 1)[0];

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Timed out waiting for message');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      waiters.get(ws)!.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function assertNoMessage(ws: WebSocket, ms = 300): Promise<void> {
  try {
    const msg = await nextMessage(ws, undefined, ms);
    throw new Error(`Unexpected message: ${JSON.stringify(msg)}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'Timed out waiting for message') return;
    throw err;
  }
}

test('a WebSocket connection without a valid session cookie is rejected', async () => {
  const { book } = await newUserWithBook();
  await assert.rejects(
    () => connect('syncer_session=not-a-real-token', book.id),
    /Unexpected server response/
  );
});

test('joining sends the authoritative (initially empty) position with revision 0', async () => {
  const { client, book } = await newUserWithBook();
  const ws = await connect(client.cookieHeader!, book.id);
  const joined = await nextMessage(ws, (m) => m.type === 'joined');
  assert.equal(joined.revision, 0);
  assert.equal(joined.location, null);
  assert.equal(joined.syncEnabled, true);
  ws.close();
});

test('A publishes a position: B receives exactly one position-update; A receives no echo (only an ack)', async () => {
  const { client, book } = await newUserWithBook();
  const wsA = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsA, (m) => m.type === 'joined');
  const wsB = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsB, (m) => m.type === 'joined');

  const eventId = randomUUID();
  wsA.send(JSON.stringify({ type: 'position', eventId, clientRevision: 0, locationType: 'pdf-page', location: { page: 5 }, progress: 0.1 }));

  const update = await nextMessage(wsB, (m) => m.type === 'position-update');
  assert.equal(update.serverRevision, 1);
  assert.equal(update.location.page, 5);
  assert.equal(update.eventId, eventId);

  const ack = await nextMessage(wsA, (m) => m.type === 'ack');
  assert.equal(ack.eventId, eventId);
  assert.equal(ack.serverRevision, 1);

  // The critical loop-prevention guarantee this server must uphold on its
  // own: it must never echo a position-update back to the session that
  // originated it. (The other half of loop prevention — a client never
  // treating an *incoming* position-update as a new local action — is a
  // client-side discipline documented in frontend/src/reader/sync/.)
  await assertNoMessage(wsA);

  wsA.close();
  wsB.close();
});

test('three simultaneous sessions: a change from one reaches the other two, and only them', async () => {
  const { client, book } = await newUserWithBook();
  const wsA = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsA, (m) => m.type === 'joined');
  const wsB = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsB, (m) => m.type === 'joined');
  const wsC = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsC, (m) => m.type === 'joined');

  wsA.send(JSON.stringify({ type: 'position', eventId: randomUUID(), clientRevision: 0, locationType: 'pdf-page', location: { page: 9 }, progress: 0.2 }));

  const [, updateB, updateC] = await Promise.all([
    nextMessage(wsA, (m) => m.type === 'ack'),
    nextMessage(wsB, (m) => m.type === 'position-update'),
    nextMessage(wsC, (m) => m.type === 'position-update'),
  ]);
  assert.equal(updateB.location.page, 9);
  assert.equal(updateC.location.page, 9);
  await assertNoMessage(wsA);

  wsA.close();
  wsB.close();
  wsC.close();
});

test('concurrent updates from two sessions resolve deterministically: the later arrival wins and both converge on it', async () => {
  const { client, book } = await newUserWithBook();
  const wsA = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsA, (m) => m.type === 'joined');
  const wsB = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsB, (m) => m.type === 'joined');

  // Fire both without awaiting in between so they race at the server.
  wsA.send(JSON.stringify({ type: 'position', eventId: 'evt-a', clientRevision: 0, locationType: 'pdf-page', location: { page: 200 }, progress: 0.8 }));
  const ackA = await nextMessage(wsA, (m) => m.type === 'ack');
  wsB.send(JSON.stringify({ type: 'position', eventId: 'evt-b', clientRevision: 0, locationType: 'pdf-page', location: { page: 150 }, progress: 0.6 }));
  const ackB = await nextMessage(wsB, (m) => m.type === 'ack');

  // Server processes strictly in arrival order, so B's later write gets the higher revision.
  assert.equal(ackA.serverRevision, 1);
  assert.equal(ackB.serverRevision, 2);

  // A must receive B's update and converge to page 150, since it is the newer revision.
  const updateOnA = await nextMessage(wsA, (m) => m.type === 'position-update');
  assert.equal(updateOnA.serverRevision, 2);
  assert.equal(updateOnA.location.page, 150);

  const progress = await (await client.get(`/api/books/${book.id}/progress`)).json();
  assert.equal(progress.location.page, 150);
  assert.equal(progress.revision, 2);

  wsA.close();
  wsB.close();
});

test('reconnecting fetches fresh authoritative state rather than trusting stale local state', async () => {
  const { client, book } = await newUserWithBook();
  const wsA = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsA, (m) => m.type === 'joined');
  wsA.send(JSON.stringify({ type: 'position', eventId: 'evt-1', clientRevision: 0, locationType: 'pdf-page', location: { page: 42 }, progress: 0.3 }));
  await nextMessage(wsA, (m) => m.type === 'ack');
  wsA.close();

  const wsA2 = await connect(client.cookieHeader!, book.id);
  const joined = await nextMessage(wsA2, (m) => m.type === 'joined');
  assert.equal(joined.revision, 1);
  assert.equal(joined.location.page, 42);
  wsA2.close();
});

test('desyncing a session stops it from publishing and from receiving position updates', async () => {
  const { client, book } = await newUserWithBook();
  const wsA = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsA, (m) => m.type === 'joined');
  const wsB = await connect(client.cookieHeader!, book.id);
  await nextMessage(wsB, (m) => m.type === 'joined');

  wsB.send(JSON.stringify({ type: 'sync-toggle', enabled: false }));
  await new Promise((r) => setTimeout(r, 50));

  // B is desynced: its own position change must not be persisted or broadcast.
  wsB.send(JSON.stringify({ type: 'position', eventId: 'evt-b1', clientRevision: 0, locationType: 'pdf-page', location: { page: 77 }, progress: 0.4 }));
  const err = await nextMessage(wsB, (m) => m.type === 'error');
  assert.match(err.message, /disabled/i);
  await assertNoMessage(wsA);

  // A is still synced and publishes: B must NOT receive it while desynced.
  wsA.send(JSON.stringify({ type: 'position', eventId: 'evt-a1', clientRevision: 0, locationType: 'pdf-page', location: { page: 88 }, progress: 0.45 }));
  await nextMessage(wsA, (m) => m.type === 'ack');
  await assertNoMessage(wsB);

  // Resuming sync makes B receive live updates again.
  wsB.send(JSON.stringify({ type: 'sync-toggle', enabled: true }));
  await new Promise((r) => setTimeout(r, 50));
  wsA.send(JSON.stringify({ type: 'position', eventId: 'evt-a2', clientRevision: 0, locationType: 'pdf-page', location: { page: 89 }, progress: 0.46 }));
  const update = await nextMessage(wsB, (m) => m.type === 'position-update');
  assert.equal(update.location.page, 89);

  wsA.close();
  wsB.close();
});

test('disabling sync for the whole book blocks publishing even if the session itself is synced', async () => {
  const { client, book } = await newUserWithBook();
  const ws = await connect(client.cookieHeader!, book.id);
  await nextMessage(ws, (m) => m.type === 'joined');

  const res = await client.put(`/api/books/${book.id}/sync`, { enabled: false });
  assert.equal(res.status, 200);

  ws.send(JSON.stringify({ type: 'position', eventId: 'evt-1', clientRevision: 0, locationType: 'pdf-page', location: { page: 3 }, progress: 0.1 }));
  const err = await nextMessage(ws, (m) => m.type === 'error');
  assert.match(err.message, /disabled/i);

  ws.close();
});
