# Architecture

One Node process. One SQLite file. A folder of book files. That's the
whole backend — see the final principle in `instructions.md` if present:
"boring underneath, beautiful on top." This document is the map; each
subsystem's own README has the detail.

## System shape

```text
                     ┌─────────────────────────────┐
  Browser  ───────▶  │  Express (backend/src/index) │
  (React SPA)  HTTP  │  - REST API  (/api/*)        │
             WS      │  - WebSocket (/ws)            │
                     │  - serves frontend/dist/*      │
                     └──────────────┬────────────────┘
                                    │
                     ┌──────────────┴────────────────┐
                     │  better-sqlite3 (synchronous)   │
                     │  data/database.sqlite            │
                     └──────────────┬────────────────┘
                                    │
                     ┌──────────────┴────────────────┐
                     │  filesystem: data/library/<u>/<b>│
                     └─────────────────────────────────┘
```

In production, `npm start` runs exactly one process that both serves the
built frontend (static files + SPA fallback) and answers `/api/*` and
`/ws` — see `backend/src/app.ts` / `index.ts`. In development the frontend
runs under Vite's own dev server (HMR) and proxies `/api` + `/ws` to the
backend (`frontend/vite.config.ts`), so the browser only ever talks to one
apparent origin either way — no CORS configuration needed anywhere.

## Why these specific technology choices (and not others)

- **SQLite via `better-sqlite3`, no ORM**: this is a single-process,
  self-hosted app — there's no second writer to coordinate with, so
  Postgres/MySQL would be pure operational overhead. `better-sqlite3` is
  synchronous, which incidentally makes the sync system's conflict
  resolution trivially correct (see `backend/src/sync/README.md`) since
  there's no interleaving to reason about within one Node process.
- **Filesystem for book files, not the database**: books can be large
  (hundreds of MB for image-heavy PDFs); storing them as BLOBs would bloat
  the SQLite file and complicate streaming/Range requests. Metadata lives
  in SQLite (`books`, `book_files`); bytes live under `data/library/`.
- **No Redis / message queue**: real-time fan-out (`backend/src/sync/hub.ts`)
  is an in-memory `Map` because there is only one process. If this app
  ever needed multiple backend instances behind a load balancer, that's
  exactly the point where a shared pub/sub would become necessary — it
  isn't yet.
- **PDF.js / epub.js, not custom renderers**: both are the de facto mature
  libraries for this; hand-rolling either would be a multi-month project
  and is explicitly out of scope.
- **No react-router**: the app has exactly three destinations (auth,
  library, one book) — `frontend/src/router.tsx` is a ~30-line History API
  router instead of a dependency.
- **`tsx`/`vite`/`typescript` as the only real dev tooling**: no test
  framework dependency (Node's built-in `node:test` + `assert/strict` +
  global `fetch` cover the backend integration tests); no CSS framework
  (plain CSS + CSS Modules, per-component); no state-management library
  (React context + a few small hooks are enough at this scale).

## Request/data flow for the two things that matter most

### Uploading a book

```text
POST /api/books (multipart)
  → multer streams to a temp file (data/tmp/)
  → magic-byte sniff (never trust the extension) — backend/src/books/routes.ts
  → format-specific metadata extraction:
      PDF:  backend/src/books/pdfMetadata.ts   (pdfjs-dist, Node build)
      EPUB: backend/src/books/epubMetadata.ts  (adm-zip + fast-xml-parser)
  → a fresh UUID book id; file moved to data/library/<userId>/<bookId>/book.<ext>
  → books + book_files rows inserted in one transaction
```

Table of contents is deliberately **not** extracted/stored server-side for
either format — the reader already fully parses the document client-side
to render it, so it reads the outline (`pdf.getOutline()`) / navigation
(`book.navigation.toc`) directly from the already-loaded document instead
of trusting a second, potentially-diverging parser. See the comment in
`backend/src/database/schema.sql` above the `books` table.

### Reading-position sync

This is the subsystem most likely to have a subtle bug reintroduced by a
careless change — read `backend/src/sync/README.md` AND
`frontend/src/reader/sync/README.md` before touching anything related to
position, sessions, or the WebSocket protocol. Short version: one WS
connection per open book per tab; the server assigns a monotonically
increasing `revision` per `(user, book)` and is the sole source of truth;
clients apply only strictly-newer revisions; a client's own
`LOCAL_USER_ACTION` (real navigation) and `REMOTE_SYNC_UPDATE` (an
incoming position from another session) are structurally separate code
paths so a sync loop is structurally impossible, not just avoided by
convention.

## Known, deliberate simplifications

- **No CRDT/vector-clock conflict resolution** — last-write-wins by
  server arrival order. Documented and tested; see the sync README.
- **Reader appearance settings (theme/font/size/etc) live in
  `localStorage`, not the server** — only reading *position* is a required
  sync surface per the product spec; appearance is a per-device
  preference. See `frontend/src/hooks/useReaderSettings.ts`.
- **The offline mutation queue for annotations is in-memory, not
  persisted across a hard reload** — see the comment at the top of
  `frontend/src/services/offlineQueue.ts` for why (the retry closures
  can't be serialized, and storing a description with no way to replay it
  would be a false promise of durability).
- **No server-generated PDF cover thumbnails** — that needs a native
  `canvas` dependency server-side, which cuts against "minimal dependency
  footprint / simple deployment." Instead the library grid renders page 1
  client-side, lazily, via `frontend/src/reader/pdf/PdfCoverThumbnail.tsx`.
  EPUB covers ARE extracted server-side (cheap: just reading one image out
  of the zip) — see `backend/src/books/epubMetadata.ts`.
- **EPUB metadata parsing ignores XML namespace prefixes**
  (`fast-xml-parser`'s `removeNSPrefix: true`) — correct for the vast
  majority of real-world EPUBs; documented in `epubMetadata.ts`.

## Security posture (see also `instructions.md` §37 if present)

- Passwords: Node's built-in `scrypt`, salted, never stored/logged in
  plaintext (`backend/src/auth/password.ts`).
- Sessions: opaque random tokens, only their SHA-256 hash is stored
  server-side, `HttpOnly`/`SameSite=Lax` (+`Secure` in production) cookie
  (`backend/src/auth/sessions.ts`).
- Every book/annotation/progress-touching route re-verifies ownership
  server-side (`backend/src/books/access.ts`'s `getOwnedBook`, and the
  equivalent in `annotations/routes.ts`) and returns a uniform 404 (not
  403) for "exists but isn't yours" — a client can't distinguish the two
  by probing IDs.
- File paths are built exclusively from server-generated UUIDs, never
  from client-supplied filenames — see the comment in
  `backend/src/storage/fileStorage.ts`.
- Uploaded files are validated by magic bytes, not by extension; EPUB
  archives are additionally checked for a genuine `mimetype` entry before
  being trusted as an EPUB (`backend/src/books/routes.ts`). EPUB zips are
  only ever read into memory buffers keyed by our own lookup logic — an
  entry's own filename is never used as an on-disk output path, so
  zip-slip isn't applicable even though the archive is untrusted (see the
  comment in `backend/src/books/epubMetadata.ts`).
- Rendered EPUB content runs in a sandboxed iframe with scripting
  disabled (`allowScriptedContent` is never set to `true` — see
  `frontend/src/reader/epub/README.md`).
- `npm audit` (run periodically — not part of any automated check here) has
  two accepted, low-risk residual findings as of this writing: `qs`
  (transitively via `body-parser`/`express`, only fixable by an Express 5
  major upgrade) is exercised here only through Express's own query-string
  parsing, which this app barely uses (no route relies on complex/nested
  query params; the WebSocket upgrade handler parses `?bookId=` manually
  via `URLSearchParams`, not Express's `req.query`); `fast-xml-parser`'s
  known advisory is in its `XMLBuilder` (serialization) — this app only
  ever calls `XMLParser().parse()` (`backend/src/books/epubMetadata.ts`),
  never builds/serializes XML, so that code path is unreachable. Re-run
  `npm audit` next time either dependency needs a bump for another reason
  anyway, and take the major-version fix then. The one advisory that WAS
  directly exploitable — `adm-zip`'s pre-0.6.0 "crafted ZIP triggers 4GB
  allocation" DoS, reachable via an untrusted EPUB upload — is fixed;
  `adm-zip` is pinned to `^0.6.0`.
- Login/register are rate-limited by a small in-memory sliding-window
  limiter (`backend/src/middleware/rateLimit.ts`) — 10 failed attempts per
  15 minutes per (IP, email) for login, so one attacker sharing a NAT/IP
  with real users can't lock those users out of their own accounts. This
  is process-local state (resets on restart, doesn't span multiple
  instances) — acceptable for a single-process self-hosted app; revisit if
  this ever runs behind a load balancer with multiple instances.
