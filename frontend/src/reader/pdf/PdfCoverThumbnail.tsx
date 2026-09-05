import { useEffect, useRef, useState } from 'react';
import { pdfjs } from './pdfjsSetup';
import { books } from '../../services/api';
import './PdfCoverThumbnail.css';

// The backend deliberately does not generate PDF cover thumbnails (that
// needs a native canvas dependency server-side — see backend/src/books/pdfMetadata.ts
// for why). Instead, the library grid renders page 1 client-side, lazily
// (only once the card is actually visible) and at a small scale.
export default function PdfCoverThumbnail({ bookId, title }: { bookId: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
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
    let renderTask: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | null = null;

    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url: books.fileUrl(bookId), withCredentials: true }).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const containerWidth = containerRef.current?.clientWidth ?? 200;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth * (window.devicePixelRatio || 1)) / baseViewport.width;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [visible, bookId]);

  return (
    <div ref={containerRef} className="pdf-cover-thumb" aria-hidden={!failed}>
      {failed ? (
        <div className="pdf-cover-thumb-fallback">{title.slice(0, 1).toUpperCase()}</div>
      ) : (
        <canvas ref={canvasRef} />
      )}
    </div>
  );
}
