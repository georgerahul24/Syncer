import type { Book } from '../types';
import { books as booksApi } from '../services/api';

// Every book is read from a fully-downloaded local copy: opening one
// downloads the whole file into Cache Storage first (ensureBookDownloaded),
// and the reader gets a blob: URL for those bytes. One full download either
// completes or reports an error, and every later open is instant and needs
// no network. Streaming via HTTP Range was tried and was fragile across
// webviews, relays and caches. The bytes stay on the device until removed
// ("Remove download" in the library card menu and the reader top bar).

const BOOK_CACHE = 'syncer-books-v1';
const INDEX_KEY = 'syncer:offline-books';
const metaKey = (bookId: string) => `syncer:offline-book-meta:${bookId}`;

// Cache entries are keyed by a fixed pseudo-URL, NOT the real fetch URL
// (booksApi.fileUrl/coverUrl). The real URL's origin is whichever server
// base was active at download time (LOCAL_BASE or REMOTE_BASE — see
// serverConfig.ts) and its ?token= query param can change across logins;
// keying the cache by that real URL means a book downloaded at home over
// LOCAL_BASE would silently fail to be found later on Tailscale (different
// origin = different cache key, no match), even though the bytes are sitting
// right there. A fixed key sidesteps that entirely — download and lookup
// always agree regardless of which base or token was active at the time.
const offlineKey = (bookId: string, kind: 'file' | 'cover' | 'thumb') => `https://offline.syncer.local/books/${bookId}/${kind}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    // best-effort only
  }
}

export function isBookOffline(bookId: string): boolean {
  return readIndex().includes(bookId);
}

export function listOfflineBooks(): Book[] {
  return readIndex()
    .map((id) => {
      try {
        const raw = localStorage.getItem(metaKey(id));
        return raw ? (JSON.parse(raw) as Book) : null;
      } catch {
        return null;
      }
    })
    .filter((b): b is Book => b !== null);
}

/** Best-effort cache of a book's metadata so the reader can still open it (title, format, etc.) when the initial `GET /books/:id` fails offline — kept for every book ever opened, not just ones downloaded for offline reading, since it's tiny. */
export function cacheBookMeta(book: Book): void {
  try {
    localStorage.setItem(metaKey(book.id), JSON.stringify(book));
  } catch {
    // best-effort only
  }
}

export function getCachedBookMeta(bookId: string): Book | null {
  try {
    const raw = localStorage.getItem(metaKey(bookId));
    return raw ? (JSON.parse(raw) as Book) : null;
  } catch {
    return null;
  }
}

async function cacheUrl(cache: Cache, fetchUrl: string, cacheKey: string, onProgress?: (fraction: number) => void): Promise<void> {
  // 'no-store' keeps the engine's own HTTP cache out of this: it has no
  // reason to hold a second full copy of a file we are about to store
  // ourselves, and a partial or revalidated response arriving where a
  // complete 200 is expected is precisely what Cache Storage refuses to
  // store.
  const res = await fetch(fetchUrl, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${fetchUrl}: ${res.status} ${res.statusText}`);

  // Content-Length is one of the few response headers readable cross-origin
  // without an explicit Access-Control-Expose-Headers (it's CORS-safelisted),
  // so this works for the native app too, where every request is
  // cross-origin. No compression middleware sits in front of this route, so
  // it's the real transfer size rather than a pre-compression figure.
  const total = Number(res.headers.get('content-length')) || 0;

  if (!onProgress || !res.body || total <= 0 || typeof TransformStream === 'undefined') {
    // No usable progress signal — still a correct download, just without a
    // moving bar.
    await cache.put(cacheKey, res);
    return;
  }

  // Counting bytes through a pass-through transform, rather than reading the
  // stream into an array of chunks and building a Blob at the end, matters
  // for more than tidiness: a book here is routinely hundreds of megabytes,
  // and buffering one whole in JS memory (chunks + the assembled Blob at
  // once) is exactly the shape that gets a mobile webview killed by the OS
  // mid-download. Piping straight into cache.put keeps peak memory at one
  // chunk while still reporting real progress.
  let received = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onProgress(Math.min(1, received / total));
        controller.enqueue(chunk);
      },
    })
  );
  try {
    // Only the content type is carried over, NOT the original headers.
    // Copying them wholesale brings `Content-Length` along, and a declared
    // length that doesn't match the bytes actually streamed in makes
    // Cache Storage reject the write — which is a real possibility whenever
    // anything between here and the server transfer-encodes the response,
    // since res.body hands us decoded bytes while the header counts encoded
    // ones. Letting Cache Storage measure the body itself can't disagree
    // with it.
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    await cache.put(cacheKey, new Response(counted, { status: 200, headers: { 'Content-Type': contentType } }));
  } catch (err) {
    // Not every engine accepts a Response whose body is still a live stream
    // here (WKWebView, which backs the macOS app, has been picky about
    // exactly this). Falling back to a plain re-fetch costs the transfer
    // twice on those engines, but "downloads without a progress bar" beats
    // "cannot download at all" — and this is the only read path, so a
    // failure here means the book simply doesn't open.
    // Out of room is not something a retry fixes, and it needs a different
    // message than "check your connection" — re-throw it as itself.
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'QuotaExceeded')) throw err;
    console.warn('streamed cache write failed, retrying buffered', err);
    const retry = await fetch(fetchUrl, { credentials: 'include', cache: 'no-store' });
    if (!retry.ok) throw new Error(`Failed to fetch ${fetchUrl}: ${retry.status} ${retry.statusText}`);
    await cache.put(cacheKey, retry);
    onProgress(1);
  }
}

// Cache Storage is evictable by default: under storage pressure the browser
// can drop a downloaded book without telling anyone, and since reading now
// depends on that copy, the book would need a full re-download at the worst
// possible moment. Asking once for persistent storage opts the origin out of
// that. It can be refused (and is a no-op where unsupported) — the code below
// re-downloads on a miss either way, so this is an improvement, not a
// requirement.
let persistenceRequested = false;
async function requestPersistentStorage(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // not supported, or the user/browser declined
  }
}

/** Turns a download failure into something worth showing a user — "out of space" and "couldn't reach the server" need different reactions from them. */
export function describeDownloadFailure(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'QuotaExceeded')) {
    return 'Not enough storage space left on this device for this book. Remove a downloaded book and try again.';
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError for every network-layer failure.
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Could not download this book. Please try again.';
}

export async function downloadBookForOffline(book: Book, onProgress?: (fraction: number) => void): Promise<void> {
  if (!('caches' in window)) throw new Error('Offline storage is not available in this browser.');
  await requestPersistentStorage();
  const cache = await caches.open(BOOK_CACHE);
  // The file dwarfs the cover in size, so it gets the vast majority of the
  // progress range — the cover fetch (no per-byte progress; it's tiny)
  // still gets to visibly move the needle instead of the whole bar sitting
  // frozen at 90% while it downloads.
  const fileWeight = book.coverUrl ? 0.9 : 1;
  onProgress?.(0);
  await cacheUrl(cache, booksApi.fileUrl(book.id), offlineKey(book.id, 'file'), (f) => onProgress?.(f * fileWeight));
  onProgress?.(fileWeight);
  if (book.coverUrl) {
    // Covers are small and optional — a failed fetch shouldn't undo the
    // (much more important) file download that already succeeded.
    await cacheUrl(cache, booksApi.coverUrl(book.id), offlineKey(book.id, 'cover')).catch(() => {});
  }
  cacheBookMeta(book);
  const ids = readIndex();
  if (!ids.includes(book.id)) writeIndex([...ids, book.id]);
  onProgress?.(1);
}

export async function removeBookOffline(bookId: string): Promise<void> {
  writeIndex(readIndex().filter((id) => id !== bookId));
  if ('caches' in window) {
    const cache = await caches.open(BOOK_CACHE);
    await cache.delete(offlineKey(bookId, 'file'));
    await cache.delete(offlineKey(bookId, 'cover'));
    await cache.delete(offlineKey(bookId, 'thumb'));
  }
}

/** A PDF cover rendered earlier from the downloaded copy (see PdfCoverThumbnail). */
export async function getStoredThumbnail(bookId: string): Promise<Blob | null> {
  if (!('caches' in window)) return null;
  try {
    const res = await (await caches.open(BOOK_CACHE)).match(offlineKey(bookId, 'thumb'));
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

export async function storeThumbnail(bookId: string, blob: Blob): Promise<void> {
  if (!('caches' in window)) return;
  try {
    await (await caches.open(BOOK_CACHE)).put(offlineKey(bookId, 'thumb'), new Response(blob, { headers: { 'Content-Type': blob.type } }));
  } catch {
    // best-effort only
  }
}

/**
 * Returns a blob: URL for a book's downloaded file, or null if it wasn't
 * downloaded for offline reading. Used to hand pdf.js/epub.js/etc. a local
 * source directly instead of the network URL — a book that's already on
 * the device has no reason to be re-fetched over the network just to open
 * it, even when the network is up (and doubly so over a relayed connection
 * like Tailscale, where re-fetching a multi-hundred-page book is genuinely
 * slow). Caller owns the returned URL and should URL.revokeObjectURL it
 * once done (e.g. on unmount).
 */
export async function getOfflineFileUrl(bookId: string): Promise<string | null> {
  if (!('caches' in window)) return null;
  // Every reader awaits this before it can open ANYTHING (see
  // useBookSource) — an uncaught rejection here (Cache Storage can throw in
  // some native-webview contexts, not just "return nothing") would leave
  // every book, downloaded or not, stuck on "Opening book…" forever instead
  // of just falling back to the network URL like a cache miss would.
  try {
    const cache = await caches.open(BOOK_CACHE);
    const res = await cache.match(offlineKey(bookId, 'file'));
    if (!res) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

// De-dupes concurrent ensureBookDownloaded calls for the same book. Two
// mounts of the same reader (a remount, React's development double-effect,
// a thumbnail and the reader itself) would otherwise each start their own
// full download of the same file.
const inFlight = new Map<string, Promise<void>>();

/**
 * Resolves to a blob: URL for this book's fully-downloaded bytes,
 * downloading them first if they aren't on the device yet. This is how every
 * reader gets its file — see the note at the top of this module for why
 * reading always goes through a complete local copy rather than streaming
 * from the server.
 *
 * Caller owns the returned URL and should URL.revokeObjectURL it when done.
 * Throws if the book can't be downloaded (offline and not previously saved,
 * server error, out of storage) — callers surface that to the user.
 */
export async function ensureBookDownloaded(book: Book, onProgress?: (fraction: number) => void): Promise<string> {
  const existing = await getOfflineFileUrl(book.id);
  if (existing) return existing;

  let pending = inFlight.get(book.id);
  if (!pending) {
    pending = downloadBookForOffline(book, onProgress).finally(() => inFlight.delete(book.id));
    inFlight.set(book.id, pending);
  }
  await pending;

  const url = await getOfflineFileUrl(book.id);
  if (!url) throw new Error('Downloaded book could not be read back from storage.');
  return url;
}

export async function getOfflineCoverUrl(bookId: string): Promise<string | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(BOOK_CACHE);
    const res = await cache.match(offlineKey(bookId, 'cover'));
    if (!res) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}
