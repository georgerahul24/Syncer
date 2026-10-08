import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { LIBRARY_DIR } from '../config.js';

// Every path here is built exclusively from server-generated UUIDs
// (userId, bookId) plus a fixed, allow-listed extension — never from a
// client-supplied filename or path. That's what makes this safe against
// path traversal: there is no untrusted segment to escape with `..`.
function assertSafeSegment(segment: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(segment)) {
    throw new Error(`Unsafe path segment: ${segment}`);
  }
}

export function bookDir(userId: string, bookId: string): string {
  assertSafeSegment(userId);
  assertSafeSegment(bookId);
  return path.join(LIBRARY_DIR, userId, bookId);
}

export function ensureBookDir(userId: string, bookId: string): string {
  const dir = bookDir(userId, bookId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function bookFilePath(userId: string, bookId: string, format: 'pdf' | 'epub' | 'txt'): string {
  return path.join(bookDir(userId, bookId), `book.${format}`);
}

export function coverFilePath(userId: string, bookId: string, ext: string): string {
  assertSafeSegment(ext.replace('.', ''));
  return path.join(bookDir(userId, bookId), `cover${ext}`);
}

export function deleteBookDir(userId: string, bookId: string): void {
  fs.rmSync(bookDir(userId, bookId), { recursive: true, force: true });
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Node's default read-stream chunk is 64 KiB. That's fine on a LAN, but a
// book download over Tailscale is a long-fat pipe — a relayed connection can
// carry 100ms+ of round-trip latency, and at that distance the transfer is
// governed by how much data stays in flight. Reading in larger chunks keeps
// the TLS/socket write path fed instead of refilling it 64 KiB at a time,
// and cuts the per-chunk syscall and TLS-record overhead on what is often a
// low-powered server doing encryption in software.
const READ_CHUNK_BYTES = 512 * 1024;

/**
 * Sends a book file or cover in full. No HTTP Range: the client always
 * downloads a whole book once and reads it locally (see
 * frontend/src/utils/offlineBooks.ts), and Cache Storage refuses a 206.
 */
export function streamFile(res: Response, filePath: string, mimeKey: string): void {
  const stat = fs.statSync(filePath);
  const mime = MIME_TYPES[mimeKey] || 'application/octet-stream';
  // A PDF/EPUB upload (or a cover image) never changes after it's stored,
  // so a long-lived cache is free correctness. A .txt "book" IS its own
  // live-edited content (see books/routes.ts's PUT /:id/content) — caching
  // it the same way would resurrect stale text after a save.
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', mimeKey === 'txt' ? 'private, no-store' : 'private, max-age=3600');
  fs.createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES }).pipe(res);
}
