# Frontend sync

`useReaderSync.ts` is the client half of the sync system described in
`backend/src/sync/README.md`. Read that first — this file covers only what's
specific to the client.

## The loop-prevention invariant

See the comment block at the top of `useReaderSync.ts`. In short:
`applyRemote` (driven by incoming `position-update`) and `publishLocalPosition`
(called by the PDF/EPUB readers on real navigation) are two structurally
separate code paths. Nothing in this hook ever wires the output of one into
the input of the other. If you're adding a new way for position to change,
ask: is this a `LOCAL_USER_ACTION` (call `publishLocalPosition`) or a
`REMOTE_SYNC_UPDATE` (already handled — just render `remoteUpdate`)? Never
both.

## Why localStorage, not just the server, decides "resume reading"

Three independent toggles can disable sync (global, per-book, per-session —
see backend README). When any of them is off, this session must still
support "resume where I left off" on refresh/reopen — that's a *different*
feature (section 12 of the product spec) from cross-device sync (section
14/15). The resolution:

- Every local position change is written to `localStorage` immediately and
  unconditionally (`writeCache`), regardless of sync state.
- The *shared* `reading_progress` row on the server is only touched when
  sync is fully enabled (`effectiveSyncEnabled`).
- Opening a book prefers the local cache when it's ahead of the server (see
  the `reconcile()` comment for the exact heuristic and its limitation), and
  otherwise adopts the server's position.

This means: same-device continuity always works via localStorage; only
cross-device continuity requires sync to be on — which is exactly the
product requirement.

## Debouncing (section 19)

`publishLocalPosition` always writes the local cache synchronously, but only
debounces (800ms) the network publish — except when called with
`{ immediate: true }`, which the readers use for discrete events (an
explicit page turn, a TOC/search jump) where the delay would feel laggy.
Continuous-scroll position updates should NOT pass `immediate`.
