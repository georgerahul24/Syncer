import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, PdfAnnotationLocation } from '../../types';
import { searchPage, type PdfSearchMatch } from './search';
import styles from './PdfSearchOverlay.module.css';

const MAX_MATCHES = 300;

export type PdfSearchResult =
  | ({ kind: 'text' } & PdfSearchMatch)
  | { kind: 'annotation'; page: number; excerpt: string; annotationId: string };

/**
 * Searches page by page, incrementally, so a large PDF never blocks the UI
 * and results stream in as they're found (see search.ts for the matching
 * approach). Only the current page's text content is held at a time.
 * Annotation matches (highlighted text + notes) are searched separately —
 * cheap, since it's just an in-memory filter over the already-loaded
 * `annotations` prop — and shown above the document-text results.
 */
export default function PdfSearchOverlay({
  doc,
  numPages,
  annotations,
  open,
  onClose,
  onJump,
}: {
  doc: PDFDocumentProxy | null;
  numPages: number;
  annotations: Annotation[];
  open: boolean;
  onClose: () => void;
  onJump: (match: PdfSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [textResults, setTextResults] = useState<PdfSearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const annotationResults = useMemo((): PdfSearchResult[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return annotations
      .filter((a) => a.locationType === 'pdf')
      .filter((a) => (a.selectedText ?? '').toLowerCase().includes(q) || (a.note ?? '').toLowerCase().includes(q))
      .map((a) => ({
        kind: 'annotation' as const,
        page: (a.location as PdfAnnotationLocation).page,
        excerpt: a.note ? `Note: ${a.note}` : `"${a.selectedText}"`,
        annotationId: a.id,
      }));
  }, [annotations, query]);

  const results = useMemo((): PdfSearchResult[] => [...annotationResults, ...textResults.map((m) => ({ kind: 'text' as const, ...m }))], [annotationResults, textResults]);

  useEffect(() => {
    if (!open || !doc) return;
    const generation = ++generationRef.current;
    setTextResults([]);
    setActiveIndex(0);
    if (!query.trim()) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      const collected: PdfSearchMatch[] = [];
      for (let page = 1; page <= numPages; page++) {
        if (generationRef.current !== generation) return;
        try {
          const matches = await searchPage(doc, page, query.trim());
          if (matches.length) {
            collected.push(...matches);
            setTextResults([...collected]);
          }
        } catch {
          // one unreadable page shouldn't abort the whole search
        }
        if (collected.length >= MAX_MATCHES) break;
      }
      if (generationRef.current === generation) setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, open, doc, numPages]);

  function jumpTo(index: number) {
    setActiveIndex(index);
    const match = results[index];
    if (match) onJump(match);
  }

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Search text and notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.length) jumpTo((activeIndex + 1) % results.length);
          }}
        />
        {results.length > 0 && (
          <>
            <span className={styles.count}>
              {activeIndex + 1} / {results.length}
              {textResults.length >= MAX_MATCHES ? '+' : ''}
            </span>
            <button type="button" className={styles.navButton} onClick={() => jumpTo((activeIndex - 1 + results.length) % results.length)} aria-label="Previous result">
              ↑
            </button>
            <button type="button" className={styles.navButton} onClick={() => jumpTo((activeIndex + 1) % results.length)} aria-label="Next result">
              ↓
            </button>
          </>
        )}
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close search">
          ✕
        </button>
      </div>
      <div className={styles.results}>
        {query.trim() && results.length === 0 && <p className={styles.empty}>{searching ? 'Searching…' : 'No results'}</p>}
        {results.map((r, i) => (
          <button key={i} type="button" className={`${styles.result} ${i === activeIndex ? styles.resultActive : ''}`} onClick={() => jumpTo(i)}>
            {r.kind === 'annotation' ? '✎ ' : ''}Page {r.page} — {r.excerpt}
          </button>
        ))}
      </div>
    </div>
  );
}
