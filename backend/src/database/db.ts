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

// reader_sessions is a live mirror of the in-memory WebSocket registry in
// sync/hub.ts (see that file), not durable state — a fresh process starts
// with zero live connections by definition, so any row still here is left
// over from a previous run that didn't shut down cleanly (e.g. a crash).
db.exec('DELETE FROM reader_sessions');
