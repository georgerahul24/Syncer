import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { getOwnedBook } from '../books/access.js';

export const annotationsRouter = Router();
// requireAuth is applied per-route (not via a blanket .use()) because this
// router is mounted at the broad '/api' prefix — see app.ts — to serve both
// '/books/:bookId/annotations' and '/annotations/:id'. A router-wide
// requireAuth would run before route matching and turn a request to any
// unrelated unknown /api/* path into a 401 instead of falling through to
// the real 404 handler.

interface AnnotationRow {
  id: string;
  userId: string;
  bookId: string;
  type: 'highlight' | 'note';
  color: string;
  locationType: string;
  location: string;
  selectedText: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: AnnotationRow) {
  return {
    id: row.id,
    bookId: row.bookId,
    type: row.type,
    color: row.color,
    locationType: row.locationType,
    location: JSON.parse(row.location),
    selectedText: row.selectedText,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getOwnedAnnotation(userId: string, id: string): AnnotationRow {
  const row = db.prepare(`SELECT * FROM annotations WHERE id = ?`).get(id) as AnnotationRow | undefined;
  if (!row || row.userId !== userId) throw new AppError(404, 'Annotation not found');
  return row;
}

const VALID_TYPES = new Set(['highlight', 'note']);
const VALID_COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple']);

annotationsRouter.get(
  '/books/:bookId/annotations',
  requireAuth,
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.bookId);
    const rows = db
      .prepare(`SELECT * FROM annotations WHERE userId = ? AND bookId = ? ORDER BY createdAt ASC`)
      .all(req.userId, book.id) as AnnotationRow[];
    res.json(rows.map(toDto));
  })
);

annotationsRouter.post(
  '/books/:bookId/annotations',
  requireAuth,
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.bookId);
    const { type, color, locationType, location, selectedText, note } = req.body ?? {};
    if (!VALID_TYPES.has(type)) throw new AppError(400, 'Invalid annotation type');
    if (typeof locationType !== 'string' || location === undefined) {
      throw new AppError(400, 'locationType and location are required');
    }
    const finalColor = VALID_COLORS.has(color) ? color : 'yellow';
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO annotations (id, userId, bookId, type, color, locationType, location, selectedText, note, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.userId,
      book.id,
      type,
      finalColor,
      locationType,
      JSON.stringify(location),
      typeof selectedText === 'string' ? selectedText : null,
      typeof note === 'string' ? note : null,
      now,
      now
    );
    res.status(201).json(toDto(getOwnedAnnotation(req.userId!, id)));
  })
);

annotationsRouter.put(
  '/annotations/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const existing = getOwnedAnnotation(req.userId!, req.params.id);
    const { color, note } = req.body ?? {};
    const finalColor = VALID_COLORS.has(color) ? color : existing.color;
    const finalNote = note === undefined ? existing.note : typeof note === 'string' ? note : null;
    db.prepare(`UPDATE annotations SET color = ?, note = ?, updatedAt = ? WHERE id = ?`).run(
      finalColor,
      finalNote,
      new Date().toISOString(),
      existing.id
    );
    res.json(toDto(getOwnedAnnotation(req.userId!, existing.id)));
  })
);

annotationsRouter.delete('/annotations/:id', requireAuth, (req, res) => {
  const existing = getOwnedAnnotation(req.userId!, req.params.id);
  db.prepare(`DELETE FROM annotations WHERE id = ?`).run(existing.id);
  res.status(204).end();
});
