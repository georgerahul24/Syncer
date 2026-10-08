// Minimal offline app shell — no Workbox, no build step.
//
// Jobs:
//   1. Satisfy Chrome's PWA install criteria (a fetch handler that can serve
//      the start URL), which is what makes Syncer a real installed app with a
//      share-sheet entry on Android.
//   2. Make launches fast and offline-proof: the page shell comes from cache
//      whenever the network is slow, and hashed assets always come from cache.
//
// Book content is not this worker's business: downloads are written to Cache
// Storage by the page itself (frontend/src/utils/offlineBooks.ts). BOOK_CACHE
// is named here only so activate doesn't delete it.

const SHELL_CACHE = 'syncer-shell-v2';
const BOOK_CACHE = 'syncer-books-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

// How long a page load waits on the network before falling back to the
// cached shell. Long enough that a healthy connection still delivers a fresh
// deploy immediately; short enough that a bad one can't stall the launch —
// waiting for a dead connection to actually *fail* could take a minute.
const NAVIGATE_NETWORK_BUDGET_MS = 1500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 can't fail the whole install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== BOOK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function navigate(event) {
  const network = fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
    }
    return response;
  });
  // Keep the refresh alive even when the cached copy wins the race, so the
  // next launch picks up the new deploy.
  event.waitUntil(network.catch(() => {}));

  return caches.match('/').then((cached) => {
    if (!cached) return network;
    const fallback = new Promise((resolve) => setTimeout(() => resolve(cached), NAVIGATE_NETWORK_BUDGET_MS));
    return Promise.race([network.catch(() => cached), fallback]);
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API and WebSocket traffic is never touched — book downloads included.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }

  // Static assets: Vite content-hashes these filenames, so a hit is always
  // current and cache-first costs nothing in staleness.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
