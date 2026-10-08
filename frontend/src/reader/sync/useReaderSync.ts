import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, NotebookPage, ReadingPosition } from '../../types';
import { progress as progressApi } from '../../services/api';
import { getApiBase } from '../../services/serverConfig';
import { getStoredToken } from '../../services/authToken';
import type { ClientMessage, ServerMessage } from './protocol';

// ============================================================================
// LOOP-PREVENTION INVARIANT — read this before touching this file.
//
// A position received from the server (`applyRemote`, driven by the
// `position-update`/`joined` messages) must NEVER be fed back into
// `publishLocalPosition`. Those two are structurally separate code paths on
// purpose: `applyRemote` only ever calls `setPosition`/`setRemoteUpdate`,
// it never calls `sendPositionMessage`. Only genuine user navigation
// (handled by the reader components, which call the `publishLocalPosition`
// this hook returns) is allowed to publish. This is the client-side half of
// the loop-prevention contract described in backend/src/sync/README.md.
// ============================================================================

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
// How long after this session's own last position change it still counts as
// "being actively read". Comfortably longer than the publish debounce, so a
// continuous scroll never falls out of the window between two publishes.
const ACTIVE_READING_MS = 5000;

// How long to wait for the server's authoritative position before opening
// the book anyway. Short: this is only ever a WebSocket handshake against a
// server we've already reached, and the alternative to waiting is opening at
// the local cache's position and visibly jumping a moment later.
const POSITION_WAIT_MS = 2000;

const PUBLISH_DEBOUNCE_MS = 800;

function localCacheKey(bookId: string): string {
  return `syncer:position:${bookId}`;
}

interface CachedPosition {
  locationType: string;
  location: unknown;
  progress: number;
  updatedAt: string;
  /**
   * The server revision this position was built on — the answer to "has
   * anyone else moved the shared position since this device last saw it?".
   *
   * Recency can't be decided by comparing `updatedAt` across devices: those
   * are each device's own wall clock, and phones and servers disagree by
   * enough to invert the comparison. The server's revision counter is
   * monotonic and shared, so it orders events without needing any clock to
   * agree. Absent (an entry written before this field existed) is treated
   * as 0, which loses to any real server revision — the safe direction.
   */
  revision?: number;
}

function readCache(bookId: string): CachedPosition | null {
  try {
    const raw = localStorage.getItem(localCacheKey(bookId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(bookId: string, pos: CachedPosition): void {
  try {
    localStorage.setItem(localCacheKey(bookId), JSON.stringify(pos));
  } catch {
    // best-effort only
  }
}

export interface RemoteUpdate {
  revision: number;
  locationType: string;
  location: unknown;
  progress: number;
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** A notebook-page (stylus ink/text) change pushed live from another session — see the file-header note on ServerNotebookUpsertMessage in protocol.ts for why this arrives unconditionally rather than behind the sync toggle. */
export interface NotebookRemoteEvent {
  seq: number;
  kind: 'upsert' | 'delete';
  page?: NotebookPage;
  pageId?: string;
}

/** Same idea as NotebookRemoteEvent, for annotations (highlights/notes). */
export interface AnnotationRemoteEvent {
  seq: number;
  kind: 'upsert' | 'delete';
  annotation?: Annotation;
  annotationId?: string;
}

export interface ReaderSync {
  connectionState: ConnectionState;
  /** Resolved once per book open: server's authoritative position, reconciled against any newer local/offline reading. Null for a never-opened book. */
  initialPosition: ReadingPosition | null;
  /** False only during the brief window before the server's position has arrived (or been given up on). Callers should hold the reader closed until it's true, so the book opens at the right place instead of jumping there. */
  positionReady: boolean;
  /** A position that arrived from another session. Consume via its `revision` (changes on every new update) — apply it as a jump, never republish it. */
  remoteUpdate: RemoteUpdate | null;
  /** A notebook-page (stylus ink/text) change from another session. Consume via `seq` (a new value on every event, including repeats of the same page). */
  notebookEvent: NotebookRemoteEvent | null;
  /** Same idea as notebookEvent, for annotations. */
  annotationEvent: AnnotationRemoteEvent | null;
  /** True only when user + book + this session are all sync-enabled. */
  effectiveSyncEnabled: boolean;
  sessionSyncEnabled: boolean;
  setSessionSync: (enabled: boolean) => void;
  /** Call ONLY from real user navigation. Debounced over the network; local cache updates immediately. */
  publishLocalPosition: (locationType: string, location: unknown, progressFraction: number, opts?: { immediate?: boolean }) => void;
  /** Best-effort final save; call from the reader page's unmount/pagehide handler. */
  flushOnExit: () => void;
}

export function useReaderSync(bookId: string, userSyncEnabled: boolean, bookSyncEnabled: boolean): ReaderSync {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  // Seed from the local cache immediately rather than waiting for `joined`:
  // when the device is offline, the socket never connects at all, and
  // without this the reader would just sit at the very start of the book
  // instead of resuming where this device last left off. `reconcile()`
  // below still supersedes this with the authoritative/merged position once
  // (if) a connection is actually established.
  const [initialPosition, setInitialPosition] = useState<ReadingPosition | null>(() => {
    const cached = readCache(bookId);
    return cached ? { locationType: cached.locationType as any, location: cached.location as any, progress: cached.progress, revision: 0, updatedAt: cached.updatedAt } : null;
  });
  // Gate on the server's answer rather than opening at the cached position
  // and correcting afterwards: the correction is a visible jump, and on the
  // formats where restoring a position is itself several settling steps
  // (EpubReader's restoreDisplay) two of them landing back to back is worse
  // than a short wait. Times out so being offline still opens the book.
  const [positionReady, setPositionReady] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteUpdate | null>(null);
  const [notebookEvent, setNotebookEvent] = useState<NotebookRemoteEvent | null>(null);
  const [annotationEvent, setAnnotationEvent] = useState<AnnotationRemoteEvent | null>(null);
  const [sessionSyncEnabled, setSessionSyncEnabledState] = useState(true);
  const contentEventSeqRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const lastAppliedRevisionRef = useRef(0);
  const lastPositionRef = useRef<CachedPosition | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);
  // True once this session has actually moved the reading position itself.
  // An session that only ever *received* a position has nothing of its own
  // worth publishing — see flushOnExit.
  const hasLocalChangeRef = useRef(false);
  // When this session last published a position of its own, for the
  // active-reader guard on incoming updates.
  const lastLocalActivityRef = useRef(0);

  const effectiveSyncEnabled = userSyncEnabled && bookSyncEnabled && sessionSyncEnabled;
  const effectiveSyncRef = useRef(effectiveSyncEnabled);
  effectiveSyncRef.current = effectiveSyncEnabled;

  const sendRaw = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    closedByUsRef.current = false;

    async function connect() {
      setConnectionState((s) => (s === 'closed' ? s : reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting'));
      // Native (Tauri) has no same-origin backend to infer host/protocol
      // from — resolve the same local-vs-remote base the REST client uses.
      // On web this base is '', so the URL construction below is unchanged.
      const apiBase = await getApiBase();
      // The WebSocket API can't set an Authorization header, so native
      // passes its token as a query param instead — see backend
      // websocket/server.ts and auth/sessions.ts.
      const token = apiBase ? getStoredToken() : null;
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      const wsUrl = apiBase
        ? `${apiBase.replace(/^http/, 'ws')}/ws?bookId=${encodeURIComponent(bookId)}${tokenParam}`
        : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?bookId=${encodeURIComponent(bookId)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      };

      ws.onclose = () => {
        if (closedByUsRef.current) return;
        // The socket couldn't connect (or dropped before joining): there is no
        // server position coming, so open from the local cache now rather
        // than sitting out the rest of POSITION_WAIT_MS.
        setPositionReady(true);
        setConnectionState('reconnecting');
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    function handleServerMessage(msg: ServerMessage) {
      if (msg.type === 'joined') {
        setConnectionState('open');
        lastAppliedRevisionRef.current = msg.revision;
        reconcile(msg);
        setPositionReady(true);
      } else if (msg.type === 'position-update') {
        // REMOTE_SYNC_UPDATE — apply only, never republish (see file header).
        if (msg.serverRevision <= lastAppliedRevisionRef.current) return; // stale-update rejection
        lastAppliedRevisionRef.current = msg.serverRevision;
        // Don't yank a reader who is mid-scroll. With two sessions open on
        // the same book, whichever one is actually being read should win,
        // and it is the one that published most recently — so inside the
        // activity window this session keeps its own position and lets its
        // own next publish carry the day. The revision is still consumed
        // above, so this is a decision not to *jump*, not a decision to
        // ignore the other session: no reply is generated here, which is
        // what keeps two sessions from volleying positions at each other.
        const activelyReading = Date.now() - lastLocalActivityRef.current < ACTIVE_READING_MS;
        if (activelyReading) return;
        const cached: CachedPosition = {
          locationType: msg.locationType,
          location: msg.location,
          progress: msg.progress,
          updatedAt: new Date().toISOString(),
          revision: msg.serverRevision,
        };
        lastPositionRef.current = cached;
        writeCache(bookId, cached);
        setRemoteUpdate({ revision: msg.serverRevision, locationType: msg.locationType, location: msg.location, progress: msg.progress });
      } else if (msg.type === 'notebook-upsert') {
        setNotebookEvent({ seq: ++contentEventSeqRef.current, kind: 'upsert', page: msg.page as unknown as NotebookPage });
      } else if (msg.type === 'notebook-delete') {
        setNotebookEvent({ seq: ++contentEventSeqRef.current, kind: 'delete', pageId: msg.pageId });
      } else if (msg.type === 'annotation-upsert') {
        setAnnotationEvent({ seq: ++contentEventSeqRef.current, kind: 'upsert', annotation: msg.annotation as unknown as Annotation });
      } else if (msg.type === 'annotation-delete') {
        setAnnotationEvent({ seq: ++contentEventSeqRef.current, kind: 'delete', annotationId: msg.annotationId });
      }
      // 'ack' and 'error' are informational only at this layer today.
    }

    function reconcile(joined: Extract<ServerMessage, { type: 'joined' }>) {
      const cached = readCache(bookId);
      const serverHasPosition = joined.location !== null;

      if (!effectiveSyncRef.current) {
        // Sync is off end-to-end: never touch the shared row, rely purely
        // on this device's own local cache for continuity.
        setInitialPosition(
          cached
            ? { locationType: cached.locationType as any, location: cached.location as any, progress: cached.progress, revision: 0, updatedAt: cached.updatedAt }
            : null
        );
        return;
      }

      // Which is newer — this device's cached position, or the server's?
      //
      // This used to ask "is my cached progress further along?", which is a
      // different question and frequently the wrong one. Progress is not
      // recency: reading is not monotonic (going back to re-read a chapter
      // lowers it), and a device that has been sitting on an old position
      // has the *higher* number whenever the other device went backwards.
      // The stale device then re-asserted its position onto the server,
      // which is both "the book didn't open where I last read it" and "the
      // other session yanked my position back".
      //
      // The right question is whether anyone else has advanced the shared
      // position since this device last saw it. If the server is still on
      // the revision our cache was built from, nothing has happened
      // elsewhere and our own reading is the later event, so re-assert it —
      // this is what makes reading offline and then reconnecting work. If
      // the server has moved past it, another device wrote more recently
      // and wins.
      const cachedRevision = cached?.revision ?? 0;
      if (cached && (!serverHasPosition || cachedRevision >= joined.revision)) {
        lastPositionRef.current = cached;
        setInitialPosition({ locationType: cached.locationType as any, location: cached.location as any, progress: cached.progress, revision: joined.revision, updatedAt: cached.updatedAt });
        sendPosition(cached.locationType, cached.location, cached.progress);
        return;
      }

      if (serverHasPosition) {
        const pos: CachedPosition = {
          locationType: joined.locationType!,
          location: joined.location,
          progress: joined.progress,
          updatedAt: new Date().toISOString(),
          revision: joined.revision,
        };
        lastPositionRef.current = pos;
        writeCache(bookId, pos);
        setInitialPosition({ locationType: joined.locationType as any, location: joined.location as any, progress: joined.progress, revision: joined.revision, updatedAt: pos.updatedAt });
      } else {
        setInitialPosition(null);
      }
    }

    function sendPosition(locationType: string, location: unknown, progressFraction: number) {
      const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sendRaw({ type: 'position', eventId, clientRevision: lastAppliedRevisionRef.current, locationType, location, progress: progressFraction });
    }

    connect();
    // Offline, or a server that never answers: open at whatever the local
    // cache had rather than holding the book shut forever.
    const readyTimer = setTimeout(() => setPositionReady(true), POSITION_WAIT_MS);
    return () => {
      clearTimeout(readyTimer);
      closedByUsRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      wsRef.current?.close();
      setConnectionState('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, sendRaw]);

  const publishLocalPosition = useCallback<ReaderSync['publishLocalPosition']>(
    (locationType, location, progressFraction, opts) => {
      const cached: CachedPosition = {
        locationType,
        location,
        progress: progressFraction,
        updatedAt: new Date().toISOString(),
        revision: lastAppliedRevisionRef.current,
      };
      lastPositionRef.current = cached;
      writeCache(bookId, cached);
      // This session has moved the position itself, which is what earns it
      // the right to publish on exit and to ignore incoming updates while
      // the reader is actively scrolling (see below).
      hasLocalChangeRef.current = true;
      lastLocalActivityRef.current = Date.now();

      if (!effectiveSyncRef.current) return;

      const send = () => {
        const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sendRaw({ type: 'position', eventId, clientRevision: lastAppliedRevisionRef.current, locationType, location, progress: progressFraction });
      };

      if (opts?.immediate) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        send();
      } else {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(send, PUBLISH_DEBOUNCE_MS);
      }
    },
    [bookId, sendRaw]
  );

  const setSessionSync = useCallback(
    (enabled: boolean) => {
      setSessionSyncEnabledState(enabled);
      sendRaw({ type: 'sync-toggle', enabled });
    },
    [sendRaw]
  );

  const flushOnExit = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const pos = lastPositionRef.current;
    if (!pos || !effectiveSyncRef.current) return;
    // Nothing of our own to flush. This matters more than it sounds: this
    // runs on backgrounding, so a second session left open on another
    // device would re-publish whatever position it had merely been *shown*
    // every time it was backgrounded — repeatedly dragging the device that
    // is actually being read back to a stale spot.
    if (!hasLocalChangeRef.current) return;
    // Prefer the live socket if it's still usable; sendBeacon is the
    // fallback for the case where the page is already tearing down.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sendRaw({ type: 'position', eventId, clientRevision: lastAppliedRevisionRef.current, locationType: pos.locationType, location: pos.location, progress: pos.progress });
    }
    progressApi.beacon(bookId, { locationType: pos.locationType, location: pos.location, progress: pos.progress });
  }, [bookId, sendRaw]);

  return {
    connectionState,
    initialPosition,
    positionReady,
    remoteUpdate,
    notebookEvent,
    annotationEvent,
    effectiveSyncEnabled,
    sessionSyncEnabled,
    setSessionSync,
    publishLocalPosition,
    flushOnExit,
  };
}
