-- Syncer database schema. Applied once at startup if tables are missing (see db.ts).
-- Kept intentionally flat and relational: no giant JSON blobs for core state.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  syncEnabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(userId);

-- Flat (non-nested) folders — a book belongs to at most one. Deliberately
-- not a tree: this is a personal reading library, not a file manager, and
-- one level of grouping is enough without the UI/DB complexity of nesting.
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(userId);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(userId, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(userId);

-- No `toc` column: the table of contents is derived client-side from the
-- already-loaded document (pdf.js outline / epub.js navigation) once the
-- reader opens a book, so it is never duplicated/cached server-side.
--
-- `folderId` is added via an ALTER TABLE migration in db.ts for databases
-- created before folders existed, not just here — see ensureColumn() there.
-- No ON DELETE action is declared: deleting a folder explicitly clears
-- `folderId` on its books first (see folders/routes.ts), so there's never
-- a dangling reference for SQLite to react to either way.
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL CHECK(format IN ('pdf','epub')),
  coverPath TEXT,
  pageCount INTEGER,
  identifier TEXT,
  syncEnabled INTEGER NOT NULL DEFAULT 1,
  folderId TEXT REFERENCES folders(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_user ON books(userId);
-- idx_books_folder is created in db.ts, AFTER the folderId migration runs —
-- an index on that column here would fail on any database that already had
-- a `books` table (created before folders existed) but hasn't had the
-- ALTER TABLE migration applied yet.

CREATE TABLE IF NOT EXISTS book_tags (
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookId, tagId)
);
CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tagId);

CREATE TABLE IF NOT EXISTS book_files (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  filePath TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  fileHash TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_files_book ON book_files(bookId);

-- One authoritative row per (user, book). `revision` is a monotonically
-- increasing server-assigned counter used to resolve concurrent updates
-- from multiple sessions (see backend/src/sync/README.md).
CREATE TABLE IF NOT EXISTS reading_progress (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locationType TEXT NOT NULL,
  location TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  sourceSessionId TEXT,
  updatedAt TEXT NOT NULL,
  UNIQUE(userId, bookId)
);
CREATE INDEX IF NOT EXISTS idx_progress_user_book ON reading_progress(userId, bookId);

CREATE TABLE IF NOT EXISTS reader_sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  syncEnabled INTEGER NOT NULL DEFAULT 1,
  lastKnownRevision INTEGER NOT NULL DEFAULT 0,
  lastSeenAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_book ON reader_sessions(userId, bookId);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('highlight','note')),
  color TEXT NOT NULL DEFAULT 'yellow',
  locationType TEXT NOT NULL,
  location TEXT NOT NULL,
  selectedText TEXT,
  note TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_user_book ON annotations(userId, bookId);

-- A blank page a user inserts into the reading flow to write/draw on, PDF
-- only for now (see frontend/src/reader/notebook/README.md for why EPUB's
-- reflowable layout doesn't have a clean equivalent of "between these two
-- pages" yet). `location` is `{ afterPage: number }`; `strokes` is a JSON
-- array of `{ color, width, points: [x,y][] }` — small, resolution-
-- independent vector data, not an image.
CREATE TABLE IF NOT EXISTS notebook_pages (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locationType TEXT NOT NULL,
  location TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  strokes TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notebook_pages_user_book ON notebook_pages(userId, bookId);

-- One row per completed reading session (see backend/src/analytics/README.md).
-- Aggregated with SQL SUM/AVG at read time rather than maintaining running
-- counters — simpler, and leaves room for time-windowed stats later
-- without needing a different data shape.
CREATE TABLE IF NOT EXISTS reading_sessions_log (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  startedAt TEXT NOT NULL,
  endedAt TEXT NOT NULL,
  durationSeconds INTEGER NOT NULL,
  startProgress REAL NOT NULL,
  endProgress REAL NOT NULL,
  pagesRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reading_log_user ON reading_sessions_log(userId);
CREATE INDEX IF NOT EXISTS idx_reading_log_book ON reading_sessions_log(bookId);

-- Library-wide document-text search index (see backend/src/search/README.md).
-- Populated at upload time (backend/src/books/textExtract.ts) and backfilled
-- for pre-existing books on startup (db.ts). FTS5 virtual tables can't carry
-- FOREIGN KEY constraints, so rows are deleted explicitly alongside the book
-- in books/routes.ts's DELETE handler instead of relying on ON DELETE CASCADE.
CREATE VIRTUAL TABLE IF NOT EXISTS book_text_fts USING fts5(
  bookId UNINDEXED,
  userId UNINDEXED,
  page UNINDEXED,
  locationType UNINDEXED,
  location UNINDEXED,
  content
);
