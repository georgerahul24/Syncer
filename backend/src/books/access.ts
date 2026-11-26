import { db } from '../database/db.js';
import { AppError } from '../middleware/errors.js';

export type BookFormat = 'pdf' | 'epub' | 'txt';

export interface BookRow {
  id: string;
  userId: string;
  title: string;
  author: string | null;
  format: BookFormat;
  coverPath: string | null;
  pageCount: number | null;
  identifier: string | null;
  syncEnabled: number;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Tables whose rows belong to one user through a `userId` column. */
type OwnedTable = 'books' | 'annotations' | 'notebook_pages' | 'tags' | 'folders';

/**
 * Fetches a row by id and verifies the requesting user owns it. Returns 404
 * (not 403) when the row exists but belongs to someone else, so a client
 * can't distinguish "not yours" from "doesn't exist" by probing IDs.
 */
export function getOwnedRow<T extends { userId: string }>(table: OwnedTable, id: string, userId: string, label: string): T {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
  if (!row || row.userId !== userId) throw new AppError(404, `${label} not found`);
  return row;
}

export function getOwnedBook(userId: string, bookId: string): BookRow {
  return getOwnedRow<BookRow>('books', bookId, userId, 'Book');
}
