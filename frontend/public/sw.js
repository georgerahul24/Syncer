// Deliberately minimal: this app doesn't do offline caching (see
// ARCHITECTURE.md's dependency-minimalism stance) — the service worker
// exists only so the app satisfies PWA installability/share-target
// requirements on Android. It does not intercept any requests; the actual
// share-target POST is handled directly by the backend (see
// backend/src/share/routes.ts), not by this worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
