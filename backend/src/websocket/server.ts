import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../database/db.js';
import { parseCookies, resolveAuthSession } from '../auth/sessions.js';
import {
  applyLocalProgress,
  broadcastProgress,
  getReadingProgress,
  getSyncFlags,
  registerSession,
  setSessionSyncEnabled,
  touchSession,
  unregisterSession,
} from '../sync/hub.js';
import type { ClientMessage, ServerMessage } from '../sync/protocol.js';
import { SESSION_COOKIE_NAME } from '../config.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface SocketState {
  isAlive: boolean;
  sessionId: string;
  userId: string;
  bookId: string;
}

const socketState = new WeakMap<WebSocket, SocketState>();

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://internal');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const session = resolveAuthSession(cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const bookId = url.searchParams.get('bookId') ?? '';
    const book = db.prepare(`SELECT id FROM books WHERE id = ? AND userId = ?`).get(bookId, session.userId);
    if (!book) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, session.userId, bookId);
    });
  });

  wss.on('connection', (ws: WebSocket, userId: string, bookId: string) => {
    const sessionId = randomUUID();
    socketState.set(ws, { isAlive: true, sessionId, userId, bookId });

    // Sessions start synced by default; the "current session" toggle is
    // entirely client-driven from here on via `sync-toggle`.
    registerSession(sessionId, ws, userId, bookId, true);

    const flags = getSyncFlags(userId, bookId);
    const effectiveSync = !!flags?.userSyncEnabled && !!flags?.bookSyncEnabled;
    const progress = getReadingProgress(userId, bookId);

    send(ws, {
      type: 'joined',
      sessionId,
      revision: progress?.revision ?? 0,
      syncEnabled: effectiveSync,
      locationType: progress?.locationType ?? null,
      location: progress ? JSON.parse(progress.location) : null,
      progress: progress?.progress ?? 0,
    });

    ws.on('pong', () => {
      const state = socketState.get(ws);
      if (state) state.isAlive = true;
    });

    ws.on('message', (raw) => {
      const state = socketState.get(ws);
      if (!state) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Malformed message' });
        return;
      }
      handleMessage(ws, state, msg);
    });

    ws.on('close', () => {
      const state = socketState.get(ws);
      if (state) unregisterSession(state.sessionId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const state = socketState.get(ws);
      if (!state) continue;
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref(); // housekeeping only — must never keep the process alive by itself
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleMessage(ws: WebSocket, state: SocketState, msg: ClientMessage): void {
  switch (msg.type) {
    case 'ping':
      touchSession(state.sessionId);
      send(ws, { type: 'pong' });
      return;

    case 'sync-toggle':
      setSessionSyncEnabled(state.sessionId, !!msg.enabled);
      return;

    case 'position': {
      const flags = getSyncFlags(state.userId, state.bookId);
      const sessionRow = db
        .prepare(`SELECT syncEnabled FROM reader_sessions WHERE id = ?`)
        .get(state.sessionId) as { syncEnabled: number } | undefined;
      const effective = !!flags?.userSyncEnabled && !!flags?.bookSyncEnabled && !!sessionRow?.syncEnabled;
      if (!effective) {
        send(ws, { type: 'error', message: 'Sync is disabled; position was not shared with other sessions' });
        return;
      }
      const row = applyLocalProgress(
        state.userId,
        state.bookId,
        state.sessionId,
        msg.locationType,
        msg.location,
        msg.progress
      );
      touchSession(state.sessionId, row.revision);
      send(ws, { type: 'ack', eventId: msg.eventId, serverRevision: row.revision });
      broadcastProgress(state.userId, state.bookId, state.sessionId, msg.eventId, row);
      return;
    }
  }
}
