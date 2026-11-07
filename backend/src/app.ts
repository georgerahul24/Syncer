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
import { appReleaseRouter } from './appRelease/routes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { FRONTEND_DIST } from './config.js';
import { isTrustedOrigin } from './middleware/origin.js';

/** Builds the Express app without binding a port — shared by index.ts (prod) and tests. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Only a proxy on this machine (nginx in front of Tailscale Funnel) is
  // trusted to say the original request was HTTPS — see secureAttr() in
  // auth/sessions.ts.
  app.set('trust proxy', 'loopback');

  // Baseline hardening headers. no-referrer also keeps the native app's
  // ?token= asset URLs out of any Referer header.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // The web app is same-origin and needs no CORS. The native apps have no
  // shared origin with this server, so their requests are cross-origin and
  // need these headers — but only they get them (see middleware/origin.ts).
  // Reflecting any Origin, as this used to, let any website call the API.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isTrustedOrigin(origin, req)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  // Public, and mounted before the routers that require sign-in for everything
  // under /api.
  app.use('/api', appReleaseRouter);
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
