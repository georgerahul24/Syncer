import path from 'node:path';
import { fileURLToPath } from 'node:url';

// backend/src/config.ts (dev, via tsx) -> backend/
// backend/dist/config.js (prod, via tsc) -> backend/
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(backendRoot, '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(appRoot, 'data');

export const LIBRARY_DIR = path.join(DATA_DIR, 'library');
export const DATABASE_PATH = path.join(DATA_DIR, 'database.sqlite');
export const FRONTEND_DIST = path.join(appRoot, 'frontend', 'dist');

export const PORT = Number(process.env.PORT) || 3001;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE_NAME = 'syncer_session';
