import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { getOwnedBook } from '../books/access.js';

export const tagsRouter = Router();

interface TagRow {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

function getOwnedTag(userId: string, id: string): TagRow {
  const row = db.prepare(`SELECT * FROM tags WHERE id = ?`).get(id) as TagRow | undefined;
  if (!row || row.userId !== userId) throw new AppError(404, 'Tag not found');
  return row;
}

/** Tags are reused across books — find one by (case-insensitive) name, or create it. */
function findOrCreateTag(userId: string, rawName: string): TagRow {
  const name = rawName.trim();
  if (!name) throw new AppError(400, 'Tag name is required');
  if (name.length > 50) throw new AppError(400, 'Tag name is too long');
  const existing = db
    .prepare(`SELECT * FROM tags WHERE userId = ? AND name = ? COLLATE NOCASE`)
    .get(userId, name) as TagRow | undefined;
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO tags (id, userId, name, createdAt) VALUES (?, ?, ?, ?)`).run(id, userId, name, now);
  return { id, userId, name, createdAt: now };
}

tagsRouter.get(
  '/tags',
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM book_tags bt WHERE bt.tagId = t.id) AS bookCount
         FROM tags t WHERE t.userId = ? ORDER BY t.name COLLATE NOCASE ASC`
      )
      .all(req.userId) as Array<TagRow & { bookCount: number }>;
    res.json(rows.map((r) => ({ id: r.id, name: r.name, bookCount: r.bookCount })));
  })
);

tagsRouter.delete('/tags/:id', requireAuth, (req, res) => {
  const tag = getOwnedTag(req.userId!, req.params.id);
  db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id); // cascades to book_tags
  res.status(204).end();
});

tagsRouter.post(
  '/books/:bookId/tags',
  requireAuth,
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.bookId);
    const tag = findOrCreateTag(req.userId!, String(req.body?.name ?? ''));
    db.prepare(`INSERT OR IGNORE INTO book_tags (bookId, tagId) VALUES (?, ?)`).run(book.id, tag.id);
    res.status(201).json({ id: tag.id, name: tag.name });
  })
);

tagsRouter.delete('/books/:bookId/tags/:tagId', requireAuth, (req, res) => {
  const book = getOwnedBook(req.userId!, req.params.bookId);
  getOwnedTag(req.userId!, req.params.tagId); // 404s if the tag isn't this user's
  db.prepare(`DELETE FROM book_tags WHERE bookId = ? AND tagId = ?`).run(book.id, req.params.tagId);
  res.status(204).end();
});
