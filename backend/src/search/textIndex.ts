import fs from 'node:fs';
import { db } from '../database/db.js';
import { bookFilePath } from '../storage/fileStorage.js';
import { extractPdfText, extractEpubText, extractTxtText, type ExtractedTextChunk } from '../books/textExtract.js';

export function indexBookText(bookId: string, userId: string, chunks: ExtractedTextChunk[]): void {
  if (chunks.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO book_text_fts (bookId, userId, page, locationType, location, content) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((rows: ExtractedTextChunk[]) => {
    for (const c of rows) insert.run(bookId, userId, c.page, c.locationType, JSON.stringify(c.location), c.text);
  });
  insertAll(chunks);
}

export function deleteBookTextIndex(bookId: string): void {
  db.prepare(`DELETE FROM book_text_fts WHERE bookId = ?`).run(bookId);
}

/**
 * Extracts and indexes a book's text. Best-effort: search is an add-on
 * feature, so a failure here (a malformed file, an unsupported PDF
 * encoding, etc.) is logged and swallowed rather than surfaced to the
 * upload flow — a book that fails to index is simply not searchable.
 */
export async function indexBookAsync(bookId: string, userId: string, format: 'pdf' | 'epub' | 'txt', filePath: string): Promise<void> {
  try {
    const chunks = format === 'pdf' ? await extractPdfText(filePath) : format === 'epub' ? extractEpubText(filePath) : extractTxtText(filePath);
    indexBookText(bookId, userId, chunks);
  } catch (err) {
    console.error(`[search] failed to index book ${bookId}:`, err);
  }
}

/** Re-indexes a .txt book from in-memory content after a live edit, without re-reading the file back off disk. */
export function reindexTxtContent(bookId: string, userId: string, content: string): void {
  deleteBookTextIndex(bookId);
  const trimmed = content.trim();
  if (trimmed) indexBookText(bookId, userId, [{ page: 1, locationType: 'txt', location: {}, text: trimmed }]);
}

/**
 * Runs once at startup for any book that predates the search feature (or
 * whose indexing previously failed) — see backend/src/search/README.md.
 * Sequential on purpose: this only ever touches the handful of books that
 * aren't indexed yet, and running it sequentially keeps CPU/memory use
 * predictable on whatever modest hardware this is self-hosted on.
 */
export async function backfillMissingTextIndexes(): Promise<void> {
  const missing = db
    .prepare(
      `SELECT b.id, b.userId, b.format FROM books b
       WHERE NOT EXISTS (SELECT 1 FROM book_text_fts f WHERE f.bookId = b.id)`
    )
    .all() as Array<{ id: string; userId: string; format: 'pdf' | 'epub' | 'txt' }>;

  for (const book of missing) {
    const filePath = bookFilePath(book.userId, book.id, book.format);
    if (!fs.existsSync(filePath)) continue;
    await indexBookAsync(book.id, book.userId, book.format, filePath);
  }
}
