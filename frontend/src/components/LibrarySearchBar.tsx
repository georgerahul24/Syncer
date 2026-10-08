import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { search as searchApi } from '../services/api';
import type { SearchResult } from '../types';
import styles from './LibrarySearchBar.module.css';

const DEBOUNCE_MS = 250;

// FTS5's snippet() wraps matches in these markers (see search/routes.ts) —
// split on them to bold the matched term without a markup-parsing library.
function renderSnippet(snippet: string) {
  const parts = snippet.split('¶');
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>));
}

function jumpPath(r: SearchResult): string {
  const page = r.locationType === 'pdf-page' || r.locationType === 'pdf' ? r.location?.page : undefined;
  const href = r.locationType === 'epub-chapter' ? r.location?.href : r.locationType === 'epub' ? (r.location as any)?.chapterHref : undefined;
  if (typeof page === 'number') return `/book/${r.bookId}?jumpPage=${page}`;
  if (typeof href === 'string' && href) return `/book/${r.bookId}?jumpHref=${encodeURIComponent(href)}`;
  return `/book/${r.bookId}`;
}

export default function LibrarySearchBar() {
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++requestIdRef.current;
      try {
        const res = await searchApi.query(value.trim());
        if (id === requestIdRef.current) {
          setResults(res);
          setOpen(true);
        }
      } catch {
        if (id === requestIdRef.current) setResults([]);
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  function pick(r: SearchResult) {
    setOpen(false);
    setQuery('');
    setResults([]);
    navigate(jumpPath(r));
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <input
        type="search"
        className={styles.input}
        placeholder="Search your library…"
        aria-label="Search your library"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && (
        <div className={styles.panel}>
          {loading && <div className={styles.status}>Searching…</div>}
          {!loading && results.length === 0 && <div className={styles.status}>No matches</div>}
          {!loading &&
            results.map((r, i) => (
              <button key={`${r.bookId}-${r.kind}-${i}`} type="button" className={styles.result} onClick={() => pick(r)}>
                <span className={styles.resultBook}>
                  {r.bookTitle}
                  {r.kind === 'annotation' && <span className={styles.resultTag}>note</span>}
                </span>
                {r.snippet && <span className={styles.resultSnippet}>{renderSnippet(r.snippet)}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
