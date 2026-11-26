import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/errors.js';
import { requireName } from '../middleware/validate.js';
import { getOwnedRow } from '../books/access.js';

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

interface FolderRow {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

const getOwnedFolder = (userId: string, id: string) => getOwnedRow<FolderRow>('folders', id, userId, 'Folder');

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
    const name = requireName(req.body?.name, 'Folder', 100);
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
    const name = requireName(req.body?.name, 'Folder', 100);
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
