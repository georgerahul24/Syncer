import { db } from '../database/db.js';
import { AppError } from '../middleware/errors.js';

export interface BookRow {
  id: string;
  userId: string;
  title: string;
  author: string | null;
  format: 'pdf' | 'epub' | 'txt';
  coverPath: string | null;
  pageCount: number | null;
  identifier: string | null;
  syncEnabled: number;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetches a book and verifies the requesting user owns it. Returns 404 (not
 * 403) when the book exists but belongs to someone else, so a client can't
 * distinguish "not yours" from "doesn't exist" by probing IDs.
 */
export function getOwnedBook(userId: string, bookId: string): BookRow {
  const book = db.prepare(`SELECT * FROM books WHERE id = ?`).get(bookId) as BookRow | undefined;
  if (!book || book.userId !== userId) {
    throw new AppError(404, 'Book not found');
  }
  return book;
}
