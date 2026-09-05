import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
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

/** Serves a file with HTTP Range support (needed for large-PDF progressive loading). */
export function streamFileWithRange(req: Request, res: Response, filePath: string, mimeKey: string): void {
  const stat = fs.statSync(filePath);
  const mime = MIME_TYPES[mimeKey] || 'application/octet-stream';
  const range = req.headers.range;
  // A PDF/EPUB upload (or a cover image) never changes after it's stored,
  // so a long-lived cache is free correctness. A .txt "book" IS its own
  // live-edited content (see books/routes.ts's PUT /:id/content) — caching
  // it the same way would resurrect stale text after a save.
  const cacheControl = mimeKey === 'txt' ? 'private, no-store' : 'private, max-age=3600';

  if (!range) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', cacheControl);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Content-Type', mime);
  fs.createReadStream(filePath, { start, end }).pipe(res);
}
