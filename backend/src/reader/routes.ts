import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { getOwnedBook } from '../books/access.js';
import { applyLocalProgress, broadcastProgress, getReadingProgress, getSyncFlags } from '../sync/hub.js';

export const readerRouter = Router();
readerRouter.use(requireAuth);

readerRouter.get(
  '/:id/progress',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const row = getReadingProgress(req.userId!, book.id);
    if (!row) {
      res.json(null);
      return;
    }
    res.json({
      locationType: row.locationType,
      location: JSON.parse(row.location),
      progress: row.progress,
      revision: row.revision,
      updatedAt: row.updatedAt,
    });
  })
);

/**
 * REST fallback for saving position: used when a WebSocket connection
 * isn't available yet, and as the `navigator.sendBeacon` target for a
 * best-effort final save when the reader page is unloading (a beacon
 * can't ride the WS connection, which may already be tearing down).
 * Goes through the same applyLocalProgress/broadcast path as the
 * WebSocket handler so both channels produce identical, race-free
 * revision bookkeeping.
 */
readerRouter.put(
  '/:id/progress',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const { locationType, location, progress } = req.body ?? {};
    if (typeof locationType !== 'string' || typeof progress !== 'number' || location === undefined) {
      throw new AppError(400, 'locationType, location and progress are required');
    }

    const flags = getSyncFlags(req.userId!, book.id);
    const effective = !!flags?.userSyncEnabled && !!flags?.bookSyncEnabled;
    if (!effective) {
      res.status(202).json({ shared: false });
      return;
    }

    const sourceSessionId = `rest:${randomUUID()}`;
    const eventId = randomUUID();
    const row = applyLocalProgress(req.userId!, book.id, sourceSessionId, locationType, location, progress);
    broadcastProgress(req.userId!, book.id, sourceSessionId, eventId, row);
    res.json({ shared: true, revision: row.revision });
  })
);
