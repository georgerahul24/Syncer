import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Annotation } from '../types';
import styles from './SearchOverlay.module.css';

const MAX_MATCHES = 300;

/** This format's annotations whose highlighted text or note contains `query` (already lowercased), with a display excerpt. */
export function matchingAnnotations(annotations: Annotation[], locationType: Annotation['locationType'], query: string) {
  return annotations
    .filter((a) => a.locationType === locationType)
    .filter((a) => (a.selectedText ?? '').toLowerCase().includes(query) || (a.note ?? '').toLowerCase().includes(query))
    .map((a) => ({ annotation: a, excerpt: a.note ? `Note: ${a.note}` : `"${a.selectedText}"` }));
}

/**
 * The in-book search panel shared by the EPUB and PDF readers. It owns the
 * input, the debounced and cancellable search run, next/previous and the
 * results list. Each format only says how to find matches:
 *
 * - `annotationMatches` is a cheap in-memory filter over the book's
 *   highlights and notes, shown first.
 * - `searchText` walks the document one chapter or page at a time and
 *   yields each batch of matches, so results stream in and a large book
 *   never blocks the UI. A new query (or closing) stops the walk.
 */
export default function SearchOverlay<T>({
  open,
  onClose,
  placeholder,
  source,
  annotationMatches,
  searchText,
  label,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  placeholder: string;
  /** The loaded book or document. A new one restarts the search; null means not ready. */
  source: unknown;
  /** Gets the trimmed, lowercased query. */
  annotationMatches: (query: string) => T[];
  /** Gets the trimmed query. */
  searchText: (query: string) => AsyncIterable<T[]>;
  label: (result: T) => ReactNode;
  onJump: (result: T) => void;
}) {
  const [query, setQuery] = useState('');
  const [textResults, setTextResults] = useState<T[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  // Read through a ref so a parent re-render (a new function each time)
  // doesn't restart a search that is already running.
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const trimmed = query.trim();
  const annotationResults = trimmed ? annotationMatches(trimmed.toLowerCase()) : [];
  const results = [...annotationResults, ...textResults];

  useEffect(() => {
    if (!open || !source) return;
    const generation = ++generationRef.current;
    setTextResults([]);
    setActiveIndex(0);
    if (!trimmed) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      const collected: T[] = [];
      for await (const batch of searchTextRef.current(trimmed)) {
        if (generationRef.current !== generation) return;
        collected.push(...batch);
        setTextResults([...collected]);
        if (collected.length >= MAX_MATCHES) break;
      }
      if (generationRef.current === generation) setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmed, open, source]);

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
          placeholder={placeholder}
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
        {trimmed && results.length === 0 && <p className={styles.empty}>{searching ? 'Searching…' : 'No results'}</p>}
        {results.map((r, i) => (
          <button key={i} type="button" className={`${styles.result} ${i === activeIndex ? styles.resultActive : ''}`} onClick={() => jumpTo(i)}>
            {label(r)}
          </button>
        ))}
      </div>
    </div>
  );
}
