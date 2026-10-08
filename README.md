# Syncer — self-hosted PDF & EPUB reader with cross-device sync

Syncer is an open-source, self-hosted ebook reader for PDF, EPUB and plain
text. Your reading position, highlights and notes sync in real time across
your phone, tablet and computer. It runs as a web app, an installable PWA,
and a native desktop/Android app (Tauri).

One Node process, one SQLite file, a folder of book files. No Docker, no
external database, no cloud account. Your books stay on your own server.

**Good fit if you want:** a private Kindle / Google Play Books / Apple Books
alternative, a Calibre-web style reader with live position sync, or a
simple way to read your own PDF and EPUB library on every device.

## Features

- **PDF and EPUB support** — PDF.js and epub.js under the hood, not a
  custom renderer.
- **Plain text (.txt) files as live-editable "books"** — open one straight
  into an editable view; edits autosave and sync like everything else
  (last-write-wins, no realtime multi-cursor merging).
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
- **Library-wide search** — one search bar finds a match across every book
  you own (document text, highlights/notes, titles), and jumps straight to
  the matching page or chapter, not just the book you have open.
- **Blank notebook pages** — insert a page anywhere in a PDF's continuous
  scroll for typed notes and freehand ink (stylus/touch pressure-sensitive).
- **Fullscreen reading** and four independent padding sliders (top/right/
  bottom/left) for dialing in a comfortable reading layout.
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

`better-sqlite3` is a native addon and compiles from source on
`npm install`, so a fresh Linux box needs a C++ build toolchain first:

```bash
# Debian/Ubuntu only, skip if `make`/`gcc` are already installed
sudo apt-get update && sudo apt-get install -y build-essential python3
```

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
| `TLS_CERT_FILE` | *(unset)* | Path to a TLS certificate. Set with `TLS_KEY_FILE` to serve HTTPS directly instead of plain HTTP |
| `TLS_KEY_FILE` | *(unset)* | Path to the matching private key |

### Installing on your phone

Chrome only offers a real **Install** — the thing that creates a proper app
icon and registers Syncer in the Android share sheet — on a *secure origin*.
That means HTTPS, or `localhost`. It is not about the ROM or the phone.

Reaching the server at `http://192.168.x.x:3001` is an insecure origin, so
Chrome silently downgrades: the menu offers "Add to Home screen", you get a
plain bookmark shortcut, no service worker is registered, and Syncer never
appears as a share target. That is the symptom this section exists to fix.

Pick whichever fits your setup:

**Tailscale (easiest, real certificate, works outside your house).** Install
Tailscale on the server and the phone, then:

```bash
tailscale cert "$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
TLS_CERT_FILE=<name>.crt TLS_KEY_FILE=<name>.key npm start
```

Open `https://<machine>.<tailnet>.ts.net:3001` on the phone. Chrome will offer
Install.

**A domain you own.** Point it at the box and terminate TLS with Caddy or
nginx, or hand the cert straight to Syncer with `TLS_CERT_FILE`/`TLS_KEY_FILE`.

**LAN only, self-signed.** Generate a cert with
[mkcert](https://github.com/FiloSottile/mkcert) for your LAN IP, install
mkcert's CA on the phone (Settings → Security → Encryption & credentials →
Install a certificate → CA certificate), then start Syncer with
`TLS_CERT_FILE`/`TLS_KEY_FILE`. A cert whose CA the phone doesn't trust is
*not* enough — Chrome treats it as insecure and you are back to a shortcut.

**Just to confirm the diagnosis**, without setting up any certificate: open
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` on the phone, add
`http://192.168.x.x:3001`, enable it, and relaunch Chrome. Install will appear.
This is a debugging aid, not a way to run the app — it disables a real
security boundary for that origin.

### Native app (desktop and Android)

The Tauri app is a thin wrapper around the same frontend. It has no origin of
its own, so it needs the server's address at build time. Copy
`frontend/.env.example` to `frontend/.env.local` and fill in:

| Variable | Purpose |
| --- | --- |
| `VITE_LOCAL_BASE` | The server on your home network, e.g. `http://192.168.1.10:3001` |
| `VITE_REMOTE_BASE` | The server from anywhere, e.g. your Tailscale address |

The app tries both at once and uses whichever answers first. Then:

```bash
npm run tauri:build            # desktop
npm run tauri:android:build    # Android APK
```

For Android, also copy the two files in `src-tauri/android-overrides/` into
the generated project (see the README there).

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

## Performance notes

- The app opens straight from this device's cached session and library, then
  refreshes in the background. A slow or dead connection never blocks the
  home screen.
- Reader code (PDF.js, epub.js) is split out and loaded only when a book opens.
- Static assets are content-hashed, gzip-compressed and cached forever. The
  service worker serves the app shell from cache when the network is slow.
- Each book is downloaded once and then read from the device.

## Stack

React + TypeScript + Vite · Express + TypeScript + `ws` · `better-sqlite3`
(no ORM) · PDF.js · epub.js · filesystem storage. Deliberately no Docker,
Redis, Postgres, or message queue — see `ARCHITECTURE.md` for why.

## License

MIT. See [LICENSE](LICENSE).
