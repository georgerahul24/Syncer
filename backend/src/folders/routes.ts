import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

interface FolderRow {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

function getOwnedFolder(userId: string, id: string): FolderRow {
  const row = db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) as FolderRow | undefined;
  if (!row || row.userId !== userId) throw new AppError(404, 'Folder not found');
  return row;
}

function toDto(row: FolderRow, bookCount: number) {
  return { id: row.id, name: row.name, createdAt: row.createdAt, bookCount };
}

foldersRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT f.*, (SELECT COUNT(*) FROM books b WHERE b.folderId = f.id) AS bookCount
         FROM folders f WHERE f.userId = ? ORDER BY f.name COLLATE NOCASE ASC`
      )
      .all(req.userId) as Array<FolderRow & { bookCount: number }>;
    res.json(rows.map((r) => toDto(r, r.bookCount)));
  })
);

foldersRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new AppError(400, 'Folder name is required');
    if (name.length > 100) throw new AppError(400, 'Folder name is too long');
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO folders (id, userId, name, createdAt) VALUES (?, ?, ?, ?)`).run(id, req.userId, name, now);
    res.status(201).json(toDto({ id, userId: req.userId!, name, createdAt: now }, 0));
  })
);

foldersRouter.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const folder = getOwnedFolder(req.userId!, req.params.id);
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw new AppError(400, 'Folder name is required');
    if (name.length > 100) throw new AppError(400, 'Folder name is too long');
    db.prepare(`UPDATE folders SET name = ? WHERE id = ?`).run(name, folder.id);
    const bookCount = (db.prepare(`SELECT COUNT(*) AS c FROM books WHERE folderId = ?`).get(folder.id) as { c: number }).c;
    res.json(toDto({ ...folder, name }, bookCount));
  })
);

foldersRouter.delete('/:id', (req, res) => {
  const folder = getOwnedFolder(req.userId!, req.params.id);
  const removeFolder = db.transaction(() => {
    // Deleting a folder never deletes the books in it — they just become unfiled.
    db.prepare(`UPDATE books SET folderId = NULL WHERE folderId = ?`).run(folder.id);
    db.prepare(`DELETE FROM folders WHERE id = ?`).run(folder.id);
  });
  removeFolder();
  res.status(204).end();
});
