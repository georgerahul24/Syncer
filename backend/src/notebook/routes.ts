import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { getOwnedBook } from '../books/access.js';

export const notebookRouter = Router();
// requireAuth is applied per-route, not via .use() — see annotations/routes.ts
// for why (this router is also mounted at the broad '/api' prefix).

interface NotebookPageRow {
  id: string;
  userId: string;
  bookId: string;
  locationType: string;
  location: string;
  text: string;
  strokes: string;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: NotebookPageRow) {
  return {
    id: row.id,
    bookId: row.bookId,
    locationType: row.locationType,
    location: JSON.parse(row.location),
    text: row.text,
    strokes: JSON.parse(row.strokes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getOwnedNotebookPage(userId: string, id: string): NotebookPageRow {
  const row = db.prepare(`SELECT * FROM notebook_pages WHERE id = ?`).get(id) as NotebookPageRow | undefined;
  if (!row || row.userId !== userId) throw new AppError(404, 'Notebook page not found');
  return row;
}

notebookRouter.get(
  '/books/:bookId/notebook-pages',
  requireAuth,
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.bookId);
    const rows = db
      .prepare(`SELECT * FROM notebook_pages WHERE userId = ? AND bookId = ? ORDER BY createdAt ASC`)
      .all(req.userId, book.id) as NotebookPageRow[];
    res.json(rows.map(toDto));
  })
);

notebookRouter.post(
  '/books/:bookId/notebook-pages',
  requireAuth,
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.bookId);
    const { afterPage, overlayPage, text, strokes } = req.body ?? {};

    let locationType: string;
    let location: unknown;
    if (typeof afterPage === 'number' && afterPage >= 0) {
      // A blank page inserted immediately after real page `afterPage`; 0
      // means "before page 1". Multiple can exist at the same anchor.
      locationType = 'pdf-page';
      location = { afterPage };
    } else if (typeof overlayPage === 'number' && overlayPage >= 1) {
      // Ink drawn directly on top of real page `overlayPage`'s own content
      // — at most one per page, so re-requesting one that already exists
      // returns it instead of creating a duplicate.
      locationType = 'pdf-page-overlay';
      location = { page: overlayPage };
      const existing = db
        .prepare(`SELECT * FROM notebook_pages WHERE userId = ? AND bookId = ? AND locationType = 'pdf-page-overlay' AND location = ?`)
        .get(req.userId, book.id, JSON.stringify(location)) as NotebookPageRow | undefined;
      if (existing) {
        res.status(200).json(toDto(existing));
        return;
      }
    } else {
      throw new AppError(400, 'afterPage or overlayPage is required');
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const initialText = typeof text === 'string' ? text : '';
    const initialStrokes = Array.isArray(strokes) ? JSON.stringify(strokes) : '[]';
    db.prepare(
      `INSERT INTO notebook_pages (id, userId, bookId, locationType, location, text, strokes, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId, book.id, locationType, JSON.stringify(location), initialText, initialStrokes, now, now);
    res.status(201).json(toDto(getOwnedNotebookPage(req.userId!, id)));
  })
);

notebookRouter.put(
  '/notebook-pages/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const existing = getOwnedNotebookPage(req.userId!, req.params.id);
    const { text, strokes } = req.body ?? {};
    const finalText = typeof text === 'string' ? text : existing.text;
    const finalStrokes = Array.isArray(strokes) ? JSON.stringify(strokes) : existing.strokes;
    db.prepare(`UPDATE notebook_pages SET text = ?, strokes = ?, updatedAt = ? WHERE id = ?`).run(
      finalText,
      finalStrokes,
      new Date().toISOString(),
      existing.id
    );
    res.json(toDto(getOwnedNotebookPage(req.userId!, existing.id)));
  })
);

notebookRouter.delete('/notebook-pages/:id', requireAuth, (req, res) => {
  const existing = getOwnedNotebookPage(req.userId!, req.params.id);
  db.prepare(`DELETE FROM notebook_pages WHERE id = ?`).run(existing.id);
  res.status(204).end();
});
