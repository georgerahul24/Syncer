import { useEffect, useRef, useState } from 'react';
import { getOfflineFileUrl, getStoredThumbnail, storeThumbnail } from '../../utils/offlineBooks';
import './PdfCoverThumbnail.css';

// The backend deliberately does not generate PDF cover thumbnails (that
// needs a native canvas dependency server-side — see backend/src/books/pdfMetadata.ts
// for why). Instead, the library grid renders page 1 client-side, lazily
// (only once the card is actually visible) and at a small scale.

// Rendered thumbnails, keyed by book id, shared across every card showing
// that book. The library renders the same book in up to three places at once
// (Continue Reading, Recently Added, All Books), and each card mounting its
// own copy of this component meant parsing the same PDF three times over.
// The promise (not just the result) is cached, so simultaneous mounts join
// one render rather than racing three.
const thumbnails = new Map<string, Promise<string | null>>();

// Wide enough to stay sharp on a high-DPI phone at the grid's card width;
// fixed rather than measured so every card shares one render regardless of
// which section it's in.
const THUMB_WIDTH_PX = 400;

async function renderThumbnail(bookId: string): Promise<string | null> {
  // A thumbnail rendered once is kept next to the downloaded book, so the
  // library doesn't re-parse every PDF on every launch just to draw covers.
  const stored = await getStoredThumbnail(bookId);
  if (stored) return URL.createObjectURL(stored);

  // Only ever use an already-downloaded copy — pulling page 1 of every PDF
  // over the network for a decorative cover is the most expensive thing the
  // library could do on a slow connection. Un-downloaded books get the
  // lettered placeholder.
  const offlineUrl = await getOfflineFileUrl(bookId);
  if (!offlineUrl) return null;

  // Loaded on demand so pdf.js stays out of the library's startup bundle.
  const { pdfjs } = await import('./pdfjsSetup');
  const loadingTask = pdfjs.getDocument({ url: offlineUrl, isEvalSupported: false });
  let doc: import('pdfjs-dist').PDFDocumentProxy | null = null;
  try {
    doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH_PX / baseViewport.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) return null;
    void storeThumbnail(bookId, blob);
    return URL.createObjectURL(blob);
  } finally {
    // Release the parsed document (and its worker-side copy) — otherwise the
    // library holds every PDF in memory for as long as it's open.
    await doc?.destroy().catch(() => {});
    URL.revokeObjectURL(offlineUrl);
  }
}

export default function PdfCoverThumbnail({ bookId, title }: { bookId: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    let pending = thumbnails.get(bookId);
    if (!pending) {
      pending = renderThumbnail(bookId).catch(() => null);
      thumbnails.set(bookId, pending);
    }
    pending.then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) setSrc(dataUrl);
      else setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [visible, bookId]);

  return (
    <div ref={containerRef} className="pdf-cover-thumb" aria-hidden={!failed}>
      {failed || !src ? (
        <div className="pdf-cover-thumb-fallback">{title.slice(0, 1).toUpperCase()}</div>
      ) : (
        <img src={src} alt="" />
      )}
    </div>
  );
}

/** Drops a book's cached thumbnail so it re-renders — call after its downloaded copy changes. */
export function forgetPdfThumbnail(bookId: string): void {
  thumbnails.delete(bookId);
}
