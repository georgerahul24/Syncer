import { useEffect, useRef, useState } from 'react';
import type { ReaderComponentProps } from '../types';
import type { TxtLocation } from '../../types';
import { books } from '../../services/api';
import { useReadingSessionTracker } from '../analytics/useReadingSessionTracker';
import styles from './TextReader.module.css';

const SAVE_DEBOUNCE_MS = 800;

/**
 * A .txt "book" is just its own live-editable content — there's no
 * pagination, table of contents, or annotation anchoring that survives an
 * edit shifting character offsets around, so (deliberately, see
 * instructions.md's task list) this reader skips TOC/annotations entirely
 * and treats "position" as a scroll-height fraction, same idea as EPUB's
 * percentage-based progress but simpler since there's only ever one
 * scrollable element.
 *
 * Saving is last-write-wins (debounced PUT of the whole content) — no
 * operational-transform/CRDT merge for concurrent multi-device edits, same
 * scope decision as every other piece of user content in this app.
 */
export default function TextReader({
  book,
  settings,
  initialPosition,
  remoteUpdate,
  onLocalPositionChange,
  onOutlineLoaded,
  outlineTarget,
  onOutlineTargetHandled,
  searchOpen,
  onSearchOpenChange,
  controlsVisible,
  onActivity,
  onError,
}: ReaderComponentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedRevisionRef = useRef<number | null>(null);
  const appliedRemoteRevisionRef = useRef<number | null>(null);
  const suppressRef = useRef(false);
  const ready = content !== null;

  useReadingSessionTracker(book.id, progress);

  useEffect(() => {
    onOutlineLoaded([]); // no table of contents for plain text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defensive only — nothing in this reader ever sets outlineTarget itself
  // (no TOC, and a library-search hit on txt content has no jump target
  // more precise than "open the book" — see search/README.md), but if it
  // somehow arrived we still need to clear it rather than leave ReaderPage
  // holding a target forever.
  useEffect(() => {
    if (outlineTarget) onOutlineTargetHandled();
  }, [outlineTarget, onOutlineTargetHandled]);

  useEffect(() => {
    let cancelled = false;
    // no-store: /file is served with a long max-age (fine for immutable
    // PDF/EPUB uploads, wrong here — a .txt "book" IS its own live-edited
    // content, so a stale cached response after a save would silently
    // resurrect old text on the next open/reload).
    fetch(books.fileUrl(book.id), { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('load failed');
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) onError('This file could not be opened.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  function scrollFraction(): number {
    const el = textareaRef.current;
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  }

  function restoreScroll(fraction: number) {
    const el = textareaRef.current;
    if (!el) return;
    suppressRef.current = true;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = max * fraction;
    setProgress(fraction);
    setTimeout(() => (suppressRef.current = false), 300);
  }

  useEffect(() => {
    if (!ready || !initialPosition) return;
    if (appliedRevisionRef.current === initialPosition.revision) return;
    appliedRevisionRef.current = initialPosition.revision;
    restoreScroll(initialPosition.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialPosition]);

  useEffect(() => {
    if (!ready || !remoteUpdate) return;
    if (appliedRemoteRevisionRef.current === remoteUpdate.revision) return;
    appliedRemoteRevisionRef.current = remoteUpdate.revision;
    restoreScroll(remoteUpdate.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, remoteUpdate]);

  function onScroll() {
    onActivity();
    if (suppressRef.current) return;
    const p = scrollFraction();
    setProgress(p);
    const loc: TxtLocation = { scrollOffset: p };
    onLocalPositionChange('txt', loc, p);
  }

  function onTextChange(value: string) {
    setContent(value);
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      books
        .saveTextContent(book.id, value)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, SAVE_DEBOUNCE_MS);
  }

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  const fontFamily = settings.fontFamily === 'georgia' ? "Georgia, 'Times New Roman', serif" : 'system-ui, sans-serif';

  return (
    <div className={styles.wrap} data-theme={settings.theme}>
      {!ready && <div className={styles.centered}>Opening book…</div>}
      {ready && (
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          style={{
            fontFamily,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            padding: `${settings.padding.top}px ${settings.padding.right}px ${settings.padding.bottom}px ${settings.padding.left}px`,
          }}
          value={content ?? ''}
          onChange={(e) => onTextChange(e.target.value)}
          onScroll={onScroll}
          onKeyDown={onActivity}
          onMouseMove={onActivity}
          spellCheck={false}
        />
      )}

      <div className={`${styles.statusRow} ${controlsVisible ? '' : styles.statusHidden}`}>
        <span className={styles.saveStatus}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save' : 'Saved'}
        </span>
      </div>

      {searchOpen && ready && (
        <TextSearchPanel content={content ?? ''} textareaRef={textareaRef} onClose={() => onSearchOpenChange(false)} />
      )}
    </div>
  );
}

function TextSearchPanel({
  content,
  textareaRef,
  onClose,
}: {
  content: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const matches = query.trim().length >= 2 ? findMatches(content, query.trim()) : [];

  function jumpTo(index: number) {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(index, index + query.trim().length);
    onClose();
  }

  return (
    <div className={styles.searchPanel}>
      <div className={styles.searchHeader}>
        <input
          autoFocus
          type="text"
          className={styles.searchInput}
          placeholder="Search this book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" onClick={onClose} aria-label="Close search">
          ✕
        </button>
      </div>
      <div className={styles.searchResults}>
        {query.trim().length >= 2 && matches.length === 0 && <div className={styles.searchEmpty}>No matches</div>}
        {matches.slice(0, 50).map((m) => (
          <button key={m.index} type="button" className={styles.searchResult} onClick={() => jumpTo(m.index)}>
            {m.context}
          </button>
        ))}
      </div>
    </div>
  );
}

function findMatches(content: string, query: string): Array<{ index: number; context: string }> {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const results: Array<{ index: number; context: string }> = [];
  let from = 0;
  while (results.length < 200) {
    const idx = lower.indexOf(q, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - 30);
    const end = Math.min(content.length, idx + q.length + 30);
    results.push({ index: idx, context: (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '') });
    from = idx + q.length;
  }
  return results;
}
