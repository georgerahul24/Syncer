import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadingPosition } from '../../types';
import { progress as progressApi } from '../../services/api';
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
const PUBLISH_DEBOUNCE_MS = 800;

function localCacheKey(bookId: string): string {
  return `syncer:position:${bookId}`;
}

interface CachedPosition {
  locationType: string;
  location: unknown;
  progress: number;
  updatedAt: string;
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

export interface ReaderSync {
  connectionState: ConnectionState;
  /** Resolved once per book open: server's authoritative position, reconciled against any newer local/offline reading. Null for a never-opened book. */
  initialPosition: ReadingPosition | null;
  /** A position that arrived from another session. Consume via its `revision` (changes on every new update) — apply it as a jump, never republish it. */
  remoteUpdate: RemoteUpdate | null;
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
  const [initialPosition, setInitialPosition] = useState<ReadingPosition | null>(null);
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteUpdate | null>(null);
  const [sessionSyncEnabled, setSessionSyncEnabledState] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const lastAppliedRevisionRef = useRef(0);
  const lastPositionRef = useRef<CachedPosition | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);

  const effectiveSyncEnabled = userSyncEnabled && bookSyncEnabled && sessionSyncEnabled;
  const effectiveSyncRef = useRef(effectiveSyncEnabled);
  effectiveSyncRef.current = effectiveSyncEnabled;

  const sendRaw = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    closedByUsRef.current = false;

    function connect() {
      setConnectionState((s) => (s === 'closed' ? s : reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting'));
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws?bookId=${encodeURIComponent(bookId)}`);
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
      } else if (msg.type === 'position-update') {
        // REMOTE_SYNC_UPDATE — apply only, never republish (see file header).
        if (msg.serverRevision <= lastAppliedRevisionRef.current) return; // stale-update rejection
        lastAppliedRevisionRef.current = msg.serverRevision;
        const cached: CachedPosition = {
          locationType: msg.locationType,
          location: msg.location,
          progress: msg.progress,
          updatedAt: new Date().toISOString(),
        };
        lastPositionRef.current = cached;
        writeCache(bookId, cached);
        setRemoteUpdate({ revision: msg.serverRevision, locationType: msg.locationType, location: msg.location, progress: msg.progress });
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

      // Heuristic: if this device's cached progress is further along than
      // what the server knows about, this device kept reading while
      // offline/disconnected — re-assert it as a fresh local action so it
      // becomes the new authoritative position (see reader/sync/README.md
      // for why this specific heuristic and its known limitation).
      if (cached && (!serverHasPosition || cached.progress > joined.progress)) {
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
    return () => {
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
      const cached: CachedPosition = { locationType, location, progress: progressFraction, updatedAt: new Date().toISOString() };
      lastPositionRef.current = cached;
      writeCache(bookId, cached);

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
    remoteUpdate,
    effectiveSyncEnabled,
    sessionSyncEnabled,
    setSessionSync,
    publishLocalPosition,
    flushOnExit,
  };
}
