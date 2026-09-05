import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, DATABASE_PATH } from '../config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DATABASE_PATH);

// Sensible self-hosted defaults: WAL allows concurrent readers while a
// write is in flight, which matters once the WebSocket layer and REST API
// are both hitting the DB from the same process. better-sqlite3 is
// synchronous, so within this single Node process writes are already
// serialized by the event loop — WAL just improves cross-connection/tooling
// behavior (e.g. reading the file while the app runs).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf-8');
db.exec(schema);

// `CREATE TABLE IF NOT EXISTS` (above) only ever creates a table once —
// it can't add a column to a `books` table that already existed before
// folders did. This is the app's whole "migration system" (see section 40
// of the product spec): a short, explicit list of idempotent column
// additions, checked and applied every startup. Add new ones here as the
// schema grows; don't reach for a migration framework for this scale.
function ensureColumn(table: string, column: string, addColumnDdl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${addColumnDdl}`);
  }
}
ensureColumn('books', 'folderId', 'folderId TEXT REFERENCES folders(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folderId)');

// SQLite can't ALTER a CHECK constraint in place — adding 'txt' as a third
// `format` value means rebuilding the table via the exact procedure SQLite's
// own docs prescribe for constraint changes ALTER TABLE can't express:
// disable FK enforcement, rebuild inside one transaction, verify with
// foreign_key_check before it commits, re-enable FK enforcement. Verified
// against a full copy of a real production database (including -wal/-shm)
// before this ever ran against one for real: row counts, all column values,
// and every index matched exactly afterward, and foreign_key_check came
// back clean. Idempotent — skips entirely once already migrated.
function migrateBooksFormatCheck(): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='books'`).get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'txt'")) return;

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE books_new (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        author TEXT,
        format TEXT NOT NULL CHECK(format IN ('pdf','epub','txt')),
        coverPath TEXT,
        pageCount INTEGER,
        identifier TEXT,
        syncEnabled INTEGER NOT NULL DEFAULT 1,
        folderId TEXT REFERENCES folders(id),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    db.exec(
      `INSERT INTO books_new SELECT id, userId, title, author, format, coverPath, pageCount, identifier, syncEnabled, folderId, createdAt, updatedAt FROM books`
    );
    db.exec(`DROP TABLE books`);
    db.exec(`ALTER TABLE books_new RENAME TO books`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_books_user ON books(userId)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folderId)');
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors.length > 0) throw new Error(`books format-check migration left dangling foreign keys: ${JSON.stringify(fkErrors)}`);
  });

  db.pragma('foreign_keys = OFF');
  try {
    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
migrateBooksFormatCheck();

// reader_sessions is a live mirror of the in-memory WebSocket registry in
// sync/hub.ts (see that file), not durable state — a fresh process starts
// with zero live connections by definition, so any row still here is left
// over from a previous run that didn't shut down cleanly (e.g. a crash).
db.exec('DELETE FROM reader_sessions');
