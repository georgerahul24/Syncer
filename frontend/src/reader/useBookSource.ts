import { useEffect, useState } from 'react';
import type { Book } from '../types';
import { books as booksApi } from '../services/api';
import { describeDownloadFailure, ensureBookDownloaded, isBookOffline } from '../utils/offlineBooks';

export type BookSource =
  /** Checking whether the book is already on the device. Brief — a Cache Storage lookup. */
  | { status: 'checking' }
  /** Transferring the file. `fraction` is 0..1, or null when the server didn't report a size. */
  | { status: 'downloading'; fraction: number | null }
  /** A blob: URL (or, in the no-Cache-Storage fallback, a network URL) the reader can open. */
  | { status: 'ready'; url: string }
  /** `retry` re-runs the download — a failure here is usually transient (the link dropped mid-transfer). */
  | { status: 'error'; message: string; retry: () => void };

/**
 * Gets a book's bytes onto the device, then hands the reader a local URL for
 * them. A book is always downloaded in full before it opens — see
 * utils/offlineBooks.ts for why that's the only read path rather than a
 * fallback behind streaming.
 *
 * The first open of a book therefore costs a visible download; every open
 * after that is a Cache Storage hit and needs no network at all.
 */
export function useBookSource(book: Book | null): BookSource {
  const [source, setSource] = useState<BookSource>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const bookId = book?.id ?? null;

  useEffect(() => {
    if (!book) return;

    // A .txt "book" is not an immutable uploaded file — it IS its own
    // live-edited content (see books/routes.ts's PUT /:id/content), so a
    // downloaded copy goes stale the moment it's edited on any device, and
    // it's a few kilobytes rather than the hundreds of megabytes this whole
    // download-first path exists for. TextReader keeps its own network-first
    // read with a downloaded-copy fallback; hand it the network URL and get
    // out of the way.
    if (book.format === 'txt') {
      setSource({ status: 'ready', url: booksApi.fileUrl(book.id) });
      return;
    }

    let cancelled = false;
    let createdObjectUrl: string | null = null;
    // A book that isn't saved yet is about to be transferred, so start on
    // the download state rather than flashing "checking" first — otherwise
    // the progress bar appears to arrive late on exactly the slow path it
    // exists for.
    setSource(isBookOffline(book.id) ? { status: 'checking' } : { status: 'downloading', fraction: null });

    ensureBookDownloaded(book, (fraction) => {
      if (!cancelled) setSource({ status: 'downloading', fraction });
    })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdObjectUrl = url;
        setSource({ status: 'ready', url });
      })
      .catch((err) => {
        if (cancelled) return;
        // Cache Storage missing entirely (an old or unusual webview, a
        // private-mode context) isn't a reason to refuse to open the book —
        // fall back to reading straight from the server, which is what every
        // reader did before downloads existed.
        if (!('caches' in window)) {
          setSource({ status: 'ready', url: booksApi.fileUrl(book.id) });
          return;
        }
        console.error('book download failed', err);
        setSource({
          status: 'error',
          message: describeDownloadFailure(err),
          retry: () => setAttempt((n) => n + 1),
        });
      });

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
    // Keyed on the id alone, NOT the whole `book` object: ReaderPage replaces
    // that object on unrelated edits (toggling per-book sync, a tag change),
    // and re-running on those would revoke the live blob: URL out from under
    // an open reader and restart the whole download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, attempt]);

  return source;
}
