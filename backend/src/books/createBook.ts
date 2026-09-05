import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { db } from '../database/db.js';
import { AppError } from '../middleware/errors.js';
import { bookFilePath, coverFilePath, ensureBookDir, sha256File } from '../storage/fileStorage.js';
import { extractPdfMetadata } from './pdfMetadata.js';
import { extractEpubMetadata } from './epubMetadata.js';
import { getOwnedBook, type BookRow } from './access.js';

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function sniffFormat(filePath: string): 'pdf' | 'epub' | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    if (head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';
    if (head.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return 'epub';
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function isGenuineEpub(filePath: string): boolean {
  try {
    const zip = new AdmZip(filePath);
    const mimeEntry = zip.getEntry('mimetype');
    if (!mimeEntry) return false;
    return zip.readAsText(mimeEntry).trim() === 'application/epub+zip';
  } catch {
    return false;
  }
}

/**
 * Validates, stores, and extracts metadata for an uploaded book file,
 * inserting the resulting `books`/`book_files` rows. Shared by the normal
 * upload endpoint (`POST /api/books`) and the PWA share-target endpoint
 * (`POST /share-target`, see app.ts) — both just get the file onto disk
 * somehow first (multer, in both cases) and hand it to this function.
 *
 * On any validation/read failure, the temp file at `tempFilePath` is
 * removed and an `AppError` is thrown; on success, `tempFilePath` no
 * longer exists (it was renamed into the library).
 */
export async function createBookFromUpload(userId: string, tempFilePath: string, originalName: string): Promise<BookRow> {
  const cleanup = () => fs.rm(tempFilePath, { force: true }, () => {});

  const format = sniffFormat(tempFilePath);
  if (!format) {
    cleanup();
    throw new AppError(400, 'Only PDF and EPUB files are supported');
  }
  if (format === 'epub' && !isGenuineEpub(tempFilePath)) {
    cleanup();
    throw new AppError(400, 'This EPUB file appears to be corrupted or invalid');
  }

  const bookId = randomUUID();
  const now = new Date().toISOString();

  let title = originalName.replace(/\.(pdf|epub)$/i, '') || 'Untitled';
  let author: string | null = null;
  let pageCount: number | null = null;
  let identifier: string | null = null;
  let coverBuffer: Buffer | null = null;
  let coverExt: string | null = null;

  try {
    if (format === 'pdf') {
      const meta = await extractPdfMetadata(tempFilePath);
      if (meta.title) title = meta.title;
      author = meta.author;
      pageCount = meta.pageCount;
    } else {
      const meta = extractEpubMetadata(tempFilePath);
      if (meta.title) title = meta.title;
      author = meta.author;
      identifier = meta.identifier;
      if (meta.cover) {
        coverBuffer = meta.cover.data;
        coverExt = meta.cover.ext;
      }
    }
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : '';
    if (/password/i.test(msg)) {
      throw new AppError(400, 'This PDF is password-protected and cannot be added');
    }
    throw new AppError(400, 'This file could not be read. It may be corrupted or unsupported.');
  }

  const fileSize = fs.statSync(tempFilePath).size;
  const fileHash = sha256File(tempFilePath);

  ensureBookDir(userId, bookId);
  const destPath = bookFilePath(userId, bookId, format);
  fs.renameSync(tempFilePath, destPath);

  let coverPath: string | null = null;
  if (coverBuffer && coverExt) {
    const dest = coverFilePath(userId, bookId, coverExt);
    fs.writeFileSync(dest, coverBuffer);
    coverPath = path.basename(dest);
  }

  const insertAll = db.transaction(() => {
    db.prepare(
      `INSERT INTO books (id, userId, title, author, format, coverPath, pageCount, identifier, syncEnabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(bookId, userId, title, author, format, coverPath, pageCount, identifier, now, now);
    db.prepare(
      `INSERT INTO book_files (id, bookId, filePath, fileSize, fileHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), bookId, path.basename(destPath), fileSize, fileHash, now);
  });
  insertAll();

  return getOwnedBook(userId, bookId);
}
