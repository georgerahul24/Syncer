import { Router } from 'express';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/errors.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

const MAX_RESULTS = 40;

interface BookMeta {
  id: string;
  title: string;
  author: string | null;
  format: 'pdf' | 'epub';
}

export interface SearchResult {
  bookId: string;
  bookTitle: string;
  bookAuthor: string | null;
  format: 'pdf' | 'epub';
  kind: 'text' | 'annotation' | 'book';
  snippet: string;
  locationType?: string;
  location?: unknown;
  annotationId?: string;
}

// Quoting + prefix-starring each term keeps this safe against FTS5 query
// syntax (a raw user string containing e.g. a lone `"` or `AND` would
// otherwise throw) while still supporting "search as you type".
function buildFtsQuery(raw: string): string {
  const terms = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

searchRouter.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const userId = req.userId!;
    const results: SearchResult[] = [];

    const books = db
      .prepare(`SELECT id, title, author, format FROM books WHERE userId = ?`)
      .all(userId) as BookMeta[];
    const bookById = new Map(books.map((b) => [b.id, b]));

    const ftsQuery = buildFtsQuery(q);
    if (ftsQuery) {
      const textRows = db
        .prepare(
          `SELECT bookId, locationType, location, snippet(book_text_fts, 5, '¶', '¶', '…', 14) AS snip
           FROM book_text_fts
           WHERE book_text_fts MATCH ? AND userId = ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(ftsQuery, userId, MAX_RESULTS) as Array<{ bookId: string; locationType: string; location: string; snip: string }>;
      for (const row of textRows) {
        const book = bookById.get(row.bookId);
        if (!book) continue;
        results.push({
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author,
          format: book.format,
          kind: 'text',
          snippet: row.snip,
          locationType: row.locationType,
          location: JSON.parse(row.location),
        });
      }
    }

    const like = `%${q}%`;
    const annotationRows = db
      .prepare(
        `SELECT id, bookId, locationType, location, note, selectedText FROM annotations
         WHERE userId = ? AND (note LIKE ? OR selectedText LIKE ?)
         ORDER BY updatedAt DESC
         LIMIT 20`
      )
      .all(userId, like, like) as Array<{
      id: string;
      bookId: string;
      locationType: string;
      location: string;
      note: string | null;
      selectedText: string | null;
    }>;
    for (const row of annotationRows) {
      const book = bookById.get(row.bookId);
      if (!book) continue;
      const snippet = (row.note && row.note.toLowerCase().includes(q.toLowerCase()) ? row.note : row.selectedText) ?? row.note ?? row.selectedText ?? '';
      results.push({
        bookId: book.id,
        bookTitle: book.title,
        bookAuthor: book.author,
        format: book.format,
        kind: 'annotation',
        snippet,
        locationType: row.locationType,
        location: JSON.parse(row.location),
        annotationId: row.id,
      });
    }

    for (const book of books) {
      if (book.title.toLowerCase().includes(q.toLowerCase()) || book.author?.toLowerCase().includes(q.toLowerCase())) {
        results.push({
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author,
          format: book.format,
          kind: 'book',
          snippet: book.author ?? '',
        });
      }
    }

    res.json(results.slice(0, MAX_RESULTS));
  })
);
