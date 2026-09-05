import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { searchPage, type PdfSearchMatch } from './search';
import styles from './PdfSearchOverlay.module.css';

const MAX_MATCHES = 300;

/**
 * Searches page by page, incrementally, so a large PDF never blocks the UI
 * and results stream in as they're found (see search.ts for the matching
 * approach). Only the current page's text content is held at a time.
 */
export default function PdfSearchOverlay({
  doc,
  numPages,
  open,
  onClose,
  onJump,
}: {
  doc: PDFDocumentProxy | null;
  numPages: number;
  open: boolean;
  onClose: () => void;
  onJump: (match: PdfSearchMatch) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PdfSearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !doc) return;
    const generation = ++generationRef.current;
    setResults([]);
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
            setResults([...collected]);
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
          placeholder="Search in book…"
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
              {results.length >= MAX_MATCHES ? '+' : ''}
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
            Page {r.page} — {r.excerpt}
          </button>
        ))}
      </div>
    </div>
  );
}
