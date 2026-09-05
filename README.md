# Syncer

A self-hosted PDF and EPUB reader with real-time cross-device reading
sync, highlights, and notes. One Node process, one SQLite file, a folder
of book files — no Docker, no external database, no cloud dependency.

## Features

- **PDF and EPUB support** — PDF.js and epub.js under the hood, not a
  custom renderer.
- **Continuous scroll or paginated reading**, per book, with keyboard and
  touch navigation.
- **Cross-device sync** — reading position follows you between tabs,
  browsers, and devices over WebSockets, with a deterministic
  server-authoritative conflict resolution and a hard guarantee against
  sync feedback loops. Can be turned off globally, per book, or for just
  the current session.
- **Highlights and notes** — select text to highlight it, attach a note,
  jump back to it from a filterable annotation panel. Positions are stored
  independent of zoom/screen size (normalized rects for PDF, CFI ranges for
  EPUB), so they never drift.
- **In-book search** across PDF and EPUB text *and* your own highlights/notes,
  with a virtualized PDF renderer that stays fast on 1000+ page documents
  (only nearby pages are ever rendered).
- **Folders and tags** to organize a large library, with drag-and-drop —
  drag books onto a folder in the sidebar, or drag files from your OS
  straight onto the library to upload them — plus reading-progress sections
  (Continue Reading / Recently Added / All Books).
- **Reading analytics dashboard** — time read, pages/characters read
  (estimated), average session length, and a day streak, both overall and
  per book. No third-party analytics; everything is computed from your own
  local reading-session log.
- **Real accounts**, scrypt-hashed passwords, per-resource ownership checks
  — this is a multi-user app, not a single-user tool with a login screen
  bolted on.
- **Offline-tolerant** — annotation edits queue and retry when the
  connection drops; reading position always resumes locally even with
  sync off.
- **Installable PWA with Android share support** — install to your home
  screen, and share a PDF/EPUB to Syncer directly from any app's share
  sheet instead of opening the library and picking the file manually.

## Quick start

Requires Node.js 20+. No database server, no Docker.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3001` and create an account.

### Configuration

| Variable   | Default        | Purpose                                                        |
| ---------- | -------------- | ---------------------------------------------------------------- |
| `PORT`     | `3001`         | HTTP/WebSocket port                                             |
| `DATA_DIR` | `<repo>/data`  | Where `database.sqlite` and `library/` live                     |
| `NODE_ENV` | `development`  | Set to `production` for a real deployment (enables the `Secure` cookie flag; put this behind HTTPS) |

### Development

```bash
npm run dev:backend    # Express + WebSocket API on :3001, auto-restarts
npm run dev:frontend   # Vite dev server on :5173, proxies /api and /ws to :3001
```

### Tests

```bash
npm test
```

Runs the backend's integration suite (Node's built-in test runner, no
extra framework) against a real ephemeral SQLite database and real
HTTP/WebSocket connections — auth, uploads, ownership, annotations, and
the sync protocol's loop-prevention and conflict-resolution behavior.

## Backing up

Everything lives under `DATA_DIR` (`./data` by default):

```text
data/database.sqlite   accounts, book metadata, progress, annotations
data/library/           the uploaded book files themselves
```

Stop the server, copy both, done. Restore by putting them back and
starting the server again — no migration step.

## Project layout

```text
backend/     Express + WebSocket API, SQLite access, book storage
frontend/    React + Vite single-page app
data/        created at runtime (gitignored)
```

`ARCHITECTURE.md` has the system-level design. Non-trivial subsystems
(sync protocol, PDF reader, EPUB reader) each have their own README next
to the code.

## Stack

React + TypeScript + Vite · Express + TypeScript + `ws` · `better-sqlite3`
(no ORM) · PDF.js · epub.js · filesystem storage. Deliberately no Docker,
Redis, Postgres, or message queue — see `ARCHITECTURE.md` for why.
