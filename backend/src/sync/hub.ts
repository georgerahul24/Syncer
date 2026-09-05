import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { db } from '../database/db.js';

interface Connection {
  ws: WebSocket;
  userId: string;
  bookId: string;
  syncEnabled: boolean;
}

// In-memory registry of live connections. This process is the single
// source of truth for real-time delivery (no Redis/pub-sub — see
// README.md in this directory for why that's fine for a self-hosted,
// single-process app). reader_sessions in SQLite mirrors this for
// bookkeeping/audit ("active sessions for a book") and survives a lookup
// even though the live `ws` handle obviously can't be persisted.
const connections = new Map<string, Connection>();
const byUserBook = new Map<string, Set<string>>();

function bookKey(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

export function registerSession(sessionId: string, ws: WebSocket, userId: string, bookId: string, syncEnabled: boolean): void {
  connections.set(sessionId, { ws, userId, bookId, syncEnabled });
  const key = bookKey(userId, bookId);
  if (!byUserBook.has(key)) byUserBook.set(key, new Set());
  byUserBook.get(key)!.add(sessionId);

  db.prepare(
    `INSERT INTO reader_sessions (id, userId, bookId, syncEnabled, lastKnownRevision, lastSeenAt, createdAt)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(sessionId, userId, bookId, syncEnabled ? 1 : 0, new Date().toISOString(), new Date().toISOString());
}

export function unregisterSession(sessionId: string): void {
  const conn = connections.get(sessionId);
  if (!conn) return;
  connections.delete(sessionId);
  byUserBook.get(bookKey(conn.userId, conn.bookId))?.delete(sessionId);
  db.prepare(`DELETE FROM reader_sessions WHERE id = ?`).run(sessionId);
}

export function setSessionSyncEnabled(sessionId: string, enabled: boolean): void {
  const conn = connections.get(sessionId);
  if (!conn) return;
  conn.syncEnabled = enabled;
  db.prepare(`UPDATE reader_sessions SET syncEnabled = ? WHERE id = ?`).run(enabled ? 1 : 0, sessionId);
}

export function touchSession(sessionId: string, revision?: number): void {
  if (revision === undefined) {
    db.prepare(`UPDATE reader_sessions SET lastSeenAt = ? WHERE id = ?`).run(new Date().toISOString(), sessionId);
  } else {
    db.prepare(`UPDATE reader_sessions SET lastSeenAt = ?, lastKnownRevision = ? WHERE id = ?`).run(
      new Date().toISOString(),
      revision,
      sessionId
    );
  }
}

interface UserBookSyncFlags {
  userSyncEnabled: boolean;
  bookSyncEnabled: boolean;
}

export function getSyncFlags(userId: string, bookId: string): UserBookSyncFlags | null {
  const row = db
    .prepare(
      `SELECT u.syncEnabled AS userSyncEnabled, b.syncEnabled AS bookSyncEnabled
       FROM users u, books b WHERE u.id = ? AND b.id = ? AND b.userId = u.id`
    )
    .get(userId, bookId) as { userSyncEnabled: number; bookSyncEnabled: number } | undefined;
  if (!row) return null;
  return { userSyncEnabled: !!row.userSyncEnabled, bookSyncEnabled: !!row.bookSyncEnabled };
}

export interface ProgressRow {
  locationType: string;
  location: string;
  progress: number;
  revision: number;
  updatedAt: string;
}

export function getReadingProgress(userId: string, bookId: string): ProgressRow | null {
  const row = db
    .prepare(
      `SELECT locationType, location, progress, revision, updatedAt FROM reading_progress WHERE userId = ? AND bookId = ?`
    )
    .get(userId, bookId) as ProgressRow | undefined;
  return row ?? null;
}

/**
 * Persists a LOCAL_USER_ACTION as the new authoritative position for
 * (userId, bookId) and assigns it the next revision. See README.md for why
 * arrival order at this single-threaded process is a sufficient, fully
 * deterministic conflict-resolution strategy: whichever update reaches
 * this function first is applied first; SQLite's UNIQUE constraint +
 * `revision = revision + 1` means the update that arrives LAST always
 * produces the highest revision and therefore wins, and every client
 * (including the "losing" sender) converges on it because clients only
 * ever accept a revision strictly greater than the last one they applied.
 */
export function applyLocalProgress(
  userId: string,
  bookId: string,
  sourceSessionId: string,
  locationType: string,
  location: unknown,
  progress: number
): ProgressRow {
  const now = new Date().toISOString();
  const locationJson = JSON.stringify(location);
  const row = db
    .prepare(
      `INSERT INTO reading_progress (id, userId, bookId, locationType, location, progress, revision, sourceSessionId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(userId, bookId) DO UPDATE SET
         locationType = excluded.locationType,
         location = excluded.location,
         progress = excluded.progress,
         revision = reading_progress.revision + 1,
         sourceSessionId = excluded.sourceSessionId,
         updatedAt = excluded.updatedAt
       RETURNING locationType, location, progress, revision, updatedAt`
    )
    .get(randomUUID(), userId, bookId, locationType, locationJson, progress, sourceSessionId, now) as ProgressRow;
  return row;
}

export function broadcastProgress(
  userId: string,
  bookId: string,
  sourceSessionId: string,
  eventId: string,
  row: ProgressRow
): void {
  const key = bookKey(userId, bookId);
  const sessionIds = byUserBook.get(key);
  if (!sessionIds) return;
  const payload = JSON.stringify({
    type: 'position-update',
    serverRevision: row.revision,
    sourceSessionId,
    eventId,
    locationType: row.locationType,
    location: JSON.parse(row.location),
    progress: row.progress,
  });
  for (const sessionId of sessionIds) {
    if (sessionId === sourceSessionId) continue;
    const conn = connections.get(sessionId);
    if (!conn || !conn.syncEnabled) continue;
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(payload);
  }
}
