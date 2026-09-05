import { useEffect, useRef, useState } from 'react';
import type Book from 'epubjs/types/book';
import styles from './EpubSearchOverlay.module.css';

interface SearchMatch {
  cfi: string;
  excerpt: string;
}

const MAX_MATCHES = 300;

/**
 * Searches sequentially, chapter by chapter, loading each section's DOM
 * only long enough to run epub.js's own text search (`Section.find`) and
 * unloading it immediately after — a large book with hundreds of chapters
 * never has more than one extra chapter DOM in memory at a time, and the
 * UI stays responsive because results stream in incrementally instead of
 * blocking until every chapter is scanned.
 */
export default function EpubSearchOverlay({
  book,
  open,
  onClose,
  onJump,
}: {
  book: Book | null;
  open: boolean;
  onClose: () => void;
  onJump: (cfi: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !book) return;
    const generation = ++generationRef.current;
    setResults([]);
    setActiveIndex(0);
    if (!query.trim()) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      const spineItems = (book.spine as unknown as { spineItems: Array<{ href: string; load: (r: Function) => Document; unload: () => void; find: (q: string) => SearchMatch[] }> }).spineItems;
      const collected: SearchMatch[] = [];
      for (const section of spineItems) {
        if (generationRef.current !== generation) return;
        try {
          // Section.load() is asynchronous (it fetches + parses the
          // chapter's XML) even though its type signature suggests
          // otherwise — awaiting it is required or section.find() runs
          // before section.document exists and silently finds nothing.
          await section.load(book.load.bind(book));
          const matches = section.find(query.trim());
          section.unload();
          collected.push(...matches);
          if (matches.length) setResults([...collected]);
        } catch {
          // an individual chapter failing to parse shouldn't abort the whole search
        }
        if (collected.length >= MAX_MATCHES) break;
      }
      if (generationRef.current === generation) setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, open, book]);

  function jumpTo(index: number) {
    setActiveIndex(index);
    const match = results[index];
    if (match) onJump(match.cfi);
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
        {query.trim() && results.length === 0 && (
          <p className={styles.empty}>{searching ? 'Searching…' : 'No results'}</p>
        )}
        {results.map((r, i) => (
          <button key={r.cfi + i} type="button" className={`${styles.result} ${i === activeIndex ? styles.resultActive : ''}`} onClick={() => jumpTo(i)}>
            {r.excerpt}
          </button>
        ))}
      </div>
    </div>
  );
}
