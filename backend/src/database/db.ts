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

// reader_sessions is a live mirror of the in-memory WebSocket registry in
// sync/hub.ts (see that file), not durable state — a fresh process starts
// with zero live connections by definition, so any row still here is left
// over from a previous run that didn't shut down cleanly (e.g. a crash).
db.exec('DELETE FROM reader_sessions');
