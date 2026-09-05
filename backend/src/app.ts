import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authRouter } from './auth/routes.js';
import { booksRouter } from './books/routes.js';
import { readerRouter } from './reader/routes.js';
import { annotationsRouter } from './annotations/routes.js';
import { foldersRouter } from './folders/routes.js';
import { tagsRouter } from './tags/routes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { FRONTEND_DIST } from './config.js';

/** Builds the Express app without binding a port — shared by index.ts (prod) and tests. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', authRouter);
  app.use('/api/books', booksRouter);
  app.use('/api/books', readerRouter);
  app.use('/api', annotationsRouter);
  app.use('/api/folders', foldersRouter);
  app.use('/api', tagsRouter);

  app.use('/api', notFoundHandler);

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
