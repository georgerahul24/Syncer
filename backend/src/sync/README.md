# Reading-position sync

This directory (plus `backend/src/websocket/server.ts`) implements real-time
reading-position sync across devices/tabs. Read this before touching either
file — the two together implement the guarantees tested in `sync.test.ts`.

## Model

- One WebSocket connection = one reader session = one open book in one tab.
  `bookId` and the derived `sessionId`/`userId` are fixed for the lifetime
  of the connection (set once during the `upgrade` auth check in
  `websocket/server.ts`) — a client never re-asserts them on later
  messages, so a message can't be spoofed as coming from another session.
- `reading_progress` has exactly one row per `(userId, bookId)`: the single
  shared "authoritative" position. `hub.applyLocalProgress` is the only
  place that writes it, and it always increments `revision`.
- The in-memory `connections`/`byUserBook` maps in `hub.ts` are the only
  real-time fan-out mechanism (no Redis/pub-sub — this is a single Node
  process by design; see the repo root ARCHITECTURE.md). `reader_sessions`
  in SQLite mirrors that registry for bookkeeping ("active sessions for a
  book") and survives independent of any one connection.

## Conflict resolution (do not rely on client clocks)

better-sqlite3 is synchronous and Node is single-threaded, so within this
process there is no real concurrency at the row level: two "simultaneous"
`position` messages are actually totally ordered by arrival. Each accepted
update does `revision = revision + 1` via SQL, so:

- Whichever message the server processes LAST always ends up with the
  highest revision, and therefore represents the current authoritative
  position — this is a deterministic **last-write-wins by server arrival
  order**, not by client timestamp (device clocks can't be trusted) and not
  by "highest page number" or similar merge heuristic.
- Every connected client — including the sender of the update that just got
  overwritten — converges on it, because a client only ever applies an
  incoming `position-update`/`joined` revision that is strictly greater
  than the last one it applied (see `frontend/src/reader/sync/useReaderSync.ts`).

This is intentionally simple. It is "boring underneath" on purpose: no
CRDTs, no vector clocks, no merge logic. See `sync.test.ts` → "concurrent
updates from two sessions resolve deterministically" for the exact
behavior under test.

## Loop prevention

The dangerous case: A changes position → server → B applies it → B's own
code re-publishes "its" new position → server → A applies it → loop.

Two independent mechanisms prevent this:

1. **Server never echoes to the sender.** `hub.broadcastProgress` excludes
   `sourceSessionId` explicitly. The sender gets an `ack` (confirmation +
   its assigned revision), never a `position-update`. This is enforced
   server-side and is covered by `sync.test.ts`.
2. **Client-side provenance discipline.** This is the half the server
   cannot enforce by itself — nothing in the wire protocol can distinguish
   "the user really turned a page" from "the client echoed what it just
   received" once both are ordinary `position` messages. So the frontend
   keeps `LOCAL_USER_ACTION` and `REMOTE_SYNC_UPDATE` as two structurally
   separate code paths (`publishLocalPosition` vs `applyRemotePosition` in
   `useReaderSync.ts`) — an incoming `position-update` only ever updates
   local state, and is never fed back into the function that sends a
   `position` message. See that file's top comment.

## Sync can be disabled at three independent levels

`users.syncEnabled` (global), `books.syncEnabled` (per book), and a
session's own `sync-toggle` (this tab only, in-memory + mirrored in
`reader_sessions.syncEnabled`). All three must be true for a `position`
message to be persisted/broadcast — see `getSyncFlags` + the session-level
check in `websocket/server.ts`'s `handleMessage`. Disabling any of them
does **not** delete or reset `reading_progress` — it just means this
session stops writing to and reading from the shared row. Per-device
continuity while desynced is the frontend's job (localStorage), not the
server's — see `frontend/src/reader/sync/README.md`.

## Reconnection

On every new connection the server sends the current authoritative
`reading_progress` row in `joined` — a reconnecting client is never
expected to trust whatever it had before the drop (`websocket/server.ts`,
"joined" send). See `sync.test.ts` → "reconnecting fetches fresh
authoritative state".
