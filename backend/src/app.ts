import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { authRouter } from './auth/routes.js';
import { booksRouter } from './books/routes.js';
import { readerRouter } from './reader/routes.js';
import { annotationsRouter } from './annotations/routes.js';
import { foldersRouter } from './folders/routes.js';
import { tagsRouter } from './tags/routes.js';
import { shareTargetRouter } from './share/routes.js';
import { analyticsRouter } from './analytics/routes.js';
import { notebookRouter } from './notebook/routes.js';
import { searchRouter } from './search/routes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { FRONTEND_DIST } from './config.js';

/** Builds the Express app without binding a port — shared by index.ts (prod) and tests. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Only a proxy on this machine (nginx in front of Tailscale Funnel) is
  // trusted to say the original request was HTTPS — see secureAttr() in
  // auth/sessions.ts.
  app.set('trust proxy', 'loopback');

  // The web app is served same-origin (no CORS needed at all). The native
  // (Tauri) app has no shared origin with this server, so its requests are
  // genuinely cross-origin — without these headers the browser/webview
  // rejects the response before the frontend ever sees it. There's no
  // meaningful origin allowlist to enforce here (single-user, self-hosted,
  // auth is the actual gate), so we just reflect whatever Origin sent the
  // request.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'Content-Type, Authorization'
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  });

  // gzip JSON and the frontend bundle. Matters most over a relayed
  // connection, where the uncompressed app bundle alone was a megabyte. Book
  // files are PDF/EPUB (not compressible types, so left alone and their
  // Content-Length — which drives the download progress bar — survives).
  app.use(compression());

  app.use(express.json({ limit: '2mb' }));

  // Unauthenticated, side-effect-free — used by native clients (see
  // frontend/src/services/serverConfig.ts) to probe which of the local vs.
  // tailscale/remote base URL is currently reachable before sending real
  // requests, so a home-network client isn't stuck paying remote latency.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/books', booksRouter);
  app.use('/api/books', readerRouter);
  app.use('/api', annotationsRouter);
  app.use('/api/folders', foldersRouter);
  app.use('/api', tagsRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', notebookRouter);
  app.use('/api', searchRouter);
  app.use(shareTargetRouter);

  app.use('/api', notFoundHandler);

  if (fs.existsSync(FRONTEND_DIST)) {
    // Vite content-hashes everything under /assets, so a file there can
    // never change under the same name — cache it for good. Everything else
    // (index.html, sw.js, the manifest) must revalidate, or a deploy would
    // never reach a device that already has the old copy.
    app.use(
      '/assets',
      express.static(path.join(FRONTEND_DIST, 'assets'), { immutable: true, maxAge: '1y', index: false })
    );
    app.use(
      express.static(FRONTEND_DIST, {
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
