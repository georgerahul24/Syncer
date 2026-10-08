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
- Opening a book asks whether anyone else has moved the shared position
  since this device last saw it, by comparing the server revision stored
  alongside the cached position against the one the server reports on
  `joined`. Same revision means nothing happened elsewhere and this device's
  own reading is the later event, so it is re-asserted (this is what makes
  reading offline and reconnecting work). A higher server revision means
  another device wrote more recently, and the server wins.

  This deliberately is *not* "whichever position is further into the book".
  Progress is not recency — reading isn't monotonic, so a device parked on
  an old position holds the higher number the moment the other device goes
  back a chapter, and it would then overwrite the server with its stale
  position. Nor is it a timestamp comparison: `updatedAt` values come from
  different devices' wall clocks, which disagree by enough to invert the
  result. The server's revision counter is the only ordering all parties
  already agree on.

This means: same-device continuity always works via localStorage; only
cross-device continuity requires sync to be on — which is exactly the
product requirement.

## Two sessions open on the same book

Beyond the loop-prevention invariant above, two further rules keep a second
open session from dragging the one actually being read:

- **An incoming `position-update` is not applied while this session is
  itself actively reading** (it published within `ACTIVE_READING_MS`). The
  revision is still consumed, and — importantly — nothing is sent in
  response, so this is a decision not to *jump*, never a reply. Two active
  sessions therefore both hold their own place and the last one still
  reading wins, rather than volleying positions at each other.
- **`flushOnExit` does nothing unless this session actually moved the
  position itself.** It runs on backgrounding, so without this a second
  session left open elsewhere would re-publish a position it had only been
  *shown*, every time it was backgrounded.

## Debouncing (section 19)

`publishLocalPosition` always writes the local cache synchronously, but only
debounces (800ms) the network publish — except when called with
`{ immediate: true }`, which the readers use for discrete events (an
explicit page turn, a TOC/search jump) where the delay would feel laggy.
Continuous-scroll position updates should NOT pass `immediate`.
