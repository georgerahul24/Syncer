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

// Optional TLS. Chrome only treats an origin as secure — and therefore only
// allows service workers and a real PWA "Install" — over HTTPS or on
// localhost. A phone reaching this server at http://<lan-ip>:3001 gets
// neither, so point these at a cert/key pair to serve HTTPS directly
// (see README, "Installing on your phone"). Both must be set, or neither.
export const TLS_CERT_FILE = process.env.TLS_CERT_FILE || '';
export const TLS_KEY_FILE = process.env.TLS_KEY_FILE || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE_NAME = 'syncer_session';

// Sign-up is open only until the first account exists: the server is
// reachable from the public internet (Tailscale Funnel), and an open sign-up
// would let anyone create an account and fill the disk with uploads.
// ALLOW_REGISTRATION=true reopens it (e.g. to add a family member).
export const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true';

// Origins allowed to call the API cross-origin with credentials: the native
// apps (Tauri serves them from these). The web app is same-origin and needs
// no entry. EXTRA_ORIGINS adds more, comma-separated.
export const NATIVE_ORIGINS = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  ...(process.env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
]);
