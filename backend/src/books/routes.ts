import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { DATA_DIR, MAX_UPLOAD_BYTES } from '../config.js';
import { bookFilePath, deleteBookDir, streamFileWithRange } from '../storage/fileStorage.js';
import { createBookFromUpload } from './createBook.js';
import { getOwnedBook, type BookRow } from './access.js';
import { deleteBookTextIndex } from '../search/textIndex.js';

export const booksRouter = Router();

export const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
// Anything left here is from an upload that never finished (e.g. the
// process crashed mid-request) — safe to clear on every startup since a
// live request always owns its temp file only within its own lifetime.
for (const name of fs.readdirSync(TMP_DIR)) {
  fs.rmSync(path.join(TMP_DIR, name), { force: true });
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

interface TagDto {
  id: string;
  name: string;
}

/** One query for however many books, rather than one query per book. */
function getTagsByBook(bookIds: string[]): Map<string, TagDto[]> {
  const map = new Map<string, TagDto[]>();
  if (bookIds.length === 0) return map;
  const placeholders = bookIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT bt.bookId AS bookId, t.id AS id, t.name AS name
       FROM book_tags bt JOIN tags t ON t.id = bt.tagId
       WHERE bt.bookId IN (${placeholders})
       ORDER BY t.name COLLATE NOCASE ASC`
    )
    .all(...bookIds) as Array<{ bookId: string; id: string; name: string }>;
  for (const row of rows) {
    if (!map.has(row.bookId)) map.set(row.bookId, []);
    map.get(row.bookId)!.push({ id: row.id, name: row.name });
  }
  return map;
}

function toDto(
  book: BookRow,
  progress?: { progress: number; updatedAt: string } | null,
  tags: TagDto[] = []
) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    pageCount: book.pageCount,
    identifier: book.identifier,
    coverUrl: book.coverPath ? `/api/books/${book.id}/cover` : null,
    syncEnabled: !!book.syncEnabled,
    folderId: book.folderId,
    tags,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    progress: progress ? { progress: progress.progress, updatedAt: progress.updatedAt } : null,
  };
}

booksRouter.use(requireAuth);

booksRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const { folderId, tag } = req.query;
    let books: BookRow[];
    if (typeof tag === 'string' && tag) {
      books = db
        .prepare(
          `SELECT b.* FROM books b
           JOIN book_tags bt ON bt.bookId = b.id
           JOIN tags t ON t.id = bt.tagId
           WHERE b.userId = ? AND t.name = ? COLLATE NOCASE
           ORDER BY b.createdAt DESC`
        )
        .all(req.userId, tag) as BookRow[];
    } else if (folderId === 'none') {
      books = db
        .prepare(`SELECT * FROM books WHERE userId = ? AND folderId IS NULL ORDER BY createdAt DESC`)
        .all(req.userId) as BookRow[];
    } else if (typeof folderId === 'string' && folderId) {
      books = db
        .prepare(`SELECT * FROM books WHERE userId = ? AND folderId = ? ORDER BY createdAt DESC`)
        .all(req.userId, folderId) as BookRow[];
    } else {
      books = db.prepare(`SELECT * FROM books WHERE userId = ? ORDER BY createdAt DESC`).all(req.userId) as BookRow[];
    }

    const progressStmt = db.prepare(
      `SELECT progress, updatedAt FROM reading_progress WHERE userId = ? AND bookId = ?`
    );
    const tagsByBook = getTagsByBook(books.map((b) => b.id));
    res.json(books.map((b) => toDto(b, progressStmt.get(req.userId, b.id) as any, tagsByBook.get(b.id) ?? [])));
  })
);

booksRouter.post(
  '/',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, 'No file was uploaded');
    const book = await createBookFromUpload(req.userId!, file.path, file.originalname);
    res.status(201).json(toDto(book));
  })
);

booksRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const progress = db
      .prepare(`SELECT progress, updatedAt FROM reading_progress WHERE userId = ? AND bookId = ?`)
      .get(req.userId, book.id) as any;
    const tags = getTagsByBook([book.id]).get(book.id) ?? [];
    res.json(toDto(book, progress, tags));
  })
);

booksRouter.get('/:id/file', (req, res) => {
  const book = getOwnedBook(req.userId!, req.params.id);
  const filePath = bookFilePath(book.userId, book.id, book.format);
  streamFileWithRange(req, res, filePath, book.format);
});

booksRouter.get('/:id/cover', (req, res) => {
  const book = getOwnedBook(req.userId!, req.params.id);
  if (!book.coverPath) throw new AppError(404, 'No cover for this book');
  const filePath = path.join(path.dirname(bookFilePath(book.userId, book.id, book.format)), book.coverPath);
  const ext = path.extname(book.coverPath);
  streamFileWithRange(req, res, filePath, ext);
});

booksRouter.delete('/:id', (req, res) => {
  const book = getOwnedBook(req.userId!, req.params.id);
  db.prepare(`DELETE FROM books WHERE id = ?`).run(book.id); // cascades via FK
  deleteBookTextIndex(book.id); // FTS5 virtual table can't carry a FOREIGN KEY, so this isn't covered by the cascade above
  deleteBookDir(book.userId, book.id);
  res.status(204).end();
});

booksRouter.put(
  '/:id/sync',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    db.prepare(`UPDATE books SET syncEnabled = ? WHERE id = ?`).run(enabled ? 1 : 0, book.id);
    res.json({ syncEnabled: enabled });
  })
);

booksRouter.put(
  '/:id/folder',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const { folderId } = req.body ?? {};
    if (folderId !== null && typeof folderId !== 'string') {
      throw new AppError(400, 'folderId must be a string or null');
    }
    if (folderId !== null) {
      const folder = db.prepare(`SELECT userId FROM folders WHERE id = ?`).get(folderId) as
        | { userId: string }
        | undefined;
      if (!folder || folder.userId !== req.userId) throw new AppError(404, 'Folder not found');
    }
    db.prepare(`UPDATE books SET folderId = ? WHERE id = ?`).run(folderId, book.id);
    res.json({ folderId });
  })
);
