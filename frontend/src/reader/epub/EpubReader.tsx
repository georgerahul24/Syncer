import { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';
import type Contents from 'epubjs/types/contents';
import type { ReaderComponentProps } from '../types';
import type { AnnotationColor, EpubAnnotationLocation, EpubLocation } from '../../types';
import { books } from '../../services/api';
import { registerThemes, applyAppearance } from './themes';
import { navItemsToToc } from './toc';
import HighlightPopup, { COLOR_VAR } from './HighlightPopup';
import EpubSearchOverlay from './EpubSearchOverlay';
import styles from './EpubReader.module.css';

interface PendingSelection {
  cfiRange: string;
  text: string;
  x: number;
  y: number;
  contents: Contents;
}

export default function EpubReader({
  book,
  settings,
  annotations,
  initialPosition,
  remoteUpdate,
  onLocalPositionChange,
  onCreateAnnotation,
  onOutlineLoaded,
  outlineTarget,
  onOutlineTargetHandled,
  focusAnnotationId,
  onFocusHandled,
  searchOpen,
  onSearchOpenChange,
  controlsVisible,
  onActivity,
  onError,
}: ReaderComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const epubBookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const currentHrefRef = useRef<string | null>(null);
  const appliedRevisionRef = useRef<number | null>(null);
  const appliedRemoteRevisionRef = useRef<number | null>(null);
  const highlightsRef = useRef<Set<string>>(new Set());
  // The last known reading location, regardless of source (user scroll,
  // TOC click, remote update) — used to redisplay at the right spot when
  // the rendition is recreated for a mode switch (see the manager-swap
  // comment below), as opposed to jumping back to initialPosition.
  const currentCfiRef = useRef<string | null>(null);

  // ==========================================================================
  // LOOP PREVENTION — read before touching relocation logic.
  //
  // epub.js's Rendition fires the SAME 'relocated' event both when the user
  // actually navigates (scroll, next()/prev(), a link click) AND when WE
  // call rendition.display(cfi) programmatically to apply server/remote
  // state. Those two cases must never be treated the same way:
  //   - applying `initialPosition`/`remoteUpdate` (REMOTE_SYNC_UPDATE, or
  //     "what the server already knows") must NOT be republished — doing
  //     so would create exactly the sync ping-pong described in
  //     backend/src/sync/README.md.
  //   - the mode-switch redisplay (the rendition-creation effect below
  //     redisplays currentCfiRef when it recreates the rendition for a new
  //     mode) is not a navigation at all and must not be published either.
  //   - an actual user action (next/prev button, TOC click, search jump)
  //     MUST still call onLocalPositionChange — it's a real
  //     LOCAL_USER_ACTION, it just happens to also go through display().
  //
  // `suppressRelocateRef` marks the NEXT 'relocated' firing as one to
  // swallow (set immediately before a non-user-initiated display() call,
  // consumed — and cleared — the moment 'relocated' fires). A timer clears
  // it as a fallback for the case where display() doesn't actually change
  // location (e.g. re-displaying the same cfi never fires 'relocated' at
  // all), so a stray suppression can never permanently block future real
  // navigation from publishing.
  // ==========================================================================
  const suppressRelocateRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discreteRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [bookForSearch, setBookForSearch] = useState<Book | null>(null);

  function programmaticDisplay(rendition: Rendition, target?: string) {
    suppressRelocateRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressRelocateRef.current = false;
    }, 800);
    return rendition.display(target);
  }

  // Loads the book itself — deliberately independent of `settings.mode` so
  // switching reading mode doesn't re-fetch the file or regenerate
  // locations (see the rendition effect below, which IS mode-dependent).
  useEffect(() => {
    let cancelled = false;
    appliedRevisionRef.current = null;
    appliedRemoteRevisionRef.current = null;
    highlightsRef.current = new Set();
    currentCfiRef.current = null;

    // epub.js's bundled .d.ts mistypes `requestCredentials` as `object`; the
    // actual runtime (book.js) treats it as a plain boolean and sets
    // `xhr.withCredentials` from it — `true` here is correct, just not
    // expressible without the cast. Same-origin requests already send the
    // session cookie by default even without this, but it's cheap insurance.
    //
    // `openAs: 'epub'` is required: epub.js's default input-type detection
    // (Book#determineType) looks at the URL's file extension to decide
    // whether to fetch-and-unzip a packed archive vs. treat the URL as an
    // already-exploded directory of files. Our book URL is
    // `/api/books/:id/file` — no `.epub` extension — so without this it
    // silently falls back to "directory" mode and tries to GET individual
    // paths like `META-INF/container.xml` relative to that URL (all 404),
    // and the book never finishes loading (stuck on "Opening book…"
    // forever, since that failure isn't a rejection epub.js surfaces).
    const epubBook = ePub(books.fileUrl(book.id), { openAs: 'epub', requestCredentials: true } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    epubBookRef.current = epubBook;
    setBookForSearch(epubBook);

    epubBook.loaded.navigation
      .then((nav) => {
        if (!cancelled) onOutlineLoaded(navItemsToToc(nav.toc));
      })
      .catch(() => {});

    // Generating locations walks the entire book's text for accurate %
    // progress — done lazily after opening so it never blocks first paint,
    // and its result is used opportunistically once available (see the
    // 'relocated' handler in the rendition effect below).
    epubBook.ready.then(() => epubBook.locations.generate(1600)).catch(() => {});

    epubBook.opened.catch(() => {
      if (!cancelled) onError('This EPUB could not be opened. It may be corrupted or invalid.');
    });

    return () => {
      cancelled = true;
      epubBook.destroy();
      epubBookRef.current = null;
    };
  }, [book.id]);

  // Creates the rendition. Depends on `settings.mode` too — NOT just to
  // change layout (that alone could use rendition.flow() live) but because
  // epub.js's `manager` (below) can only be chosen at construction time, so
  // a mode switch has to tear down and recreate the whole rendition.
  useEffect(() => {
    const epubBook = epubBookRef.current;
    if (!epubBook || !containerRef.current) return;
    let cancelled = false;
    setReady(false);

    const rendition = epubBook.renderTo(containerRef.current, {
      width: '100%',
      height: '100%',
      flow: settings.mode === 'paginated' ? 'paginated' : 'scrolled-doc',
      // epub.js's default manager only makes the CURRENT section scrollable
      // internally — it never advances to the next section as you reach
      // the bottom, so continuous mode looked completely stuck once you
      // scrolled to the end of a chapter (TOC navigation worked fine since
      // that goes through display() directly, bypassing this entirely).
      // The 'continuous' manager is what actually chains sections together
      // into one seamless scroll. Paginated mode keeps the default manager
      // (continuous doesn't apply — it's a scroll-only concept), and since
      // `manager` can't be changed on a live rendition, a mode switch needs
      // this whole effect to re-run and rebuild the rendition from scratch.
      manager: settings.mode === 'paginated' ? 'default' : 'continuous',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    registerThemes(rendition);
    applyAppearance(rendition, settings);

    rendition.on('relocated', (location: { start: { cfi: string; href: string; percentage: number } }) => {
      const cfi = location.start.cfi;
      const href = location.start.href;
      currentHrefRef.current = href;
      currentCfiRef.current = cfi;
      let pct = location.start.percentage ?? 0;
      try {
        if (epubBook.locations.length() > 0) pct = epubBook.locations.percentageFromCfi(cfi);
      } catch {
        // locations not ready yet — fall back to the section-based percentage above
      }
      setProgress(pct);

      if (suppressRelocateRef.current) {
        suppressRelocateRef.current = false;
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
        return; // REMOTE_SYNC_UPDATE or a non-navigation redisplay — never republish
      }

      const loc: EpubLocation = { cfi, chapterHref: href, scrollOffset: 0 };
      const opts = discreteRef.current ? { immediate: true } : undefined;
      discreteRef.current = false;
      onLocalPositionChange('epub-cfi', loc, pct, opts);
    });

    rendition.on('selected', (cfiRange: string, contents: Contents) => {
      const sel = contents.window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || !sel || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const frame = contents.document.defaultView?.frameElement as HTMLElement | undefined;
      const frameRect = frame?.getBoundingClientRect();
      setSelection({
        cfiRange,
        text,
        x: (frameRect?.left ?? 0) + rect.left + rect.width / 2,
        y: (frameRect?.top ?? 0) + rect.top,
        contents,
      });
    });

    rendition.on('rendered', (_section: unknown, view: { document?: Document }) => {
      const doc = view?.document;
      if (!doc) return;
      const wake = () => onActivity();
      doc.addEventListener('mousemove', wake);
      doc.addEventListener('click', wake);
      doc.addEventListener('keydown', wake);
      doc.addEventListener('touchstart', wake);
    });

    // Keyboard page turns. epub.js forwards DOM events from inside each
    // chapter's iframe through the rendition itself (see passEvents in its
    // source), so this fires regardless of whether focus is on the outer
    // page or inside the currently-rendered chapter content.
    rendition.on('keydown', (e: KeyboardEvent) => {
      if (settings.mode !== 'paginated') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        discreteRef.current = true;
        rendition.next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        discreteRef.current = true;
        rendition.prev();
      }
    });

    // Touch swipe for paginated mode — epub.js does not turn pages on
    // swipe by itself, only forwards the raw touch events.
    let touchStartX: number | null = null;
    rendition.on('touchstart', (e: TouchEvent) => {
      touchStartX = e.changedTouches[0]?.clientX ?? null;
    });
    rendition.on('touchend', (e: TouchEvent) => {
      if (touchStartX == null || settings.mode !== 'paginated') return;
      const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      touchStartX = null;
      const SWIPE_THRESHOLD = 40;
      if (dx <= -SWIPE_THRESHOLD) {
        discreteRef.current = true;
        rendition.next();
      } else if (dx >= SWIPE_THRESHOLD) {
        discreteRef.current = true;
        rendition.prev();
      }
    });

    rendition.on('displayerror', () => {
      if (!cancelled) onError('This book could not be displayed. It may use unsupported EPUB features.');
    });

    // Redisplay wherever the user actually was (currentCfiRef) across a
    // mode-switch recreation; only a brand-new mount (nothing read yet)
    // falls back to the authoritative initialPosition.
    const startCfi = currentCfiRef.current ?? (initialPosition ? (initialPosition.location as EpubLocation).cfi : undefined);
    epubBook.ready
      .then(() => programmaticDisplay(rendition, startCfi))
      .then(() => {
        if (cancelled) return;
        if (initialPosition && !currentCfiRef.current) appliedRevisionRef.current = initialPosition.revision;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onError('This EPUB could not be opened. It may be corrupted or invalid.');
      });

    return () => {
      cancelled = true;
      rendition.destroy();
      renditionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, settings.mode]);

  // A later authoritative position (e.g. after a reconnect reconciles state)
  // arrives with a new `revision` — jump to it once, not on every render.
  useEffect(() => {
    if (!ready || !initialPosition || !renditionRef.current) return;
    if (appliedRevisionRef.current === initialPosition.revision) return;
    appliedRevisionRef.current = initialPosition.revision;
    programmaticDisplay(renditionRef.current, (initialPosition.location as EpubLocation).cfi);
  }, [ready, initialPosition]);

  useEffect(() => {
    if (!remoteUpdate || !renditionRef.current) return;
    if (appliedRemoteRevisionRef.current === remoteUpdate.revision) return;
    appliedRemoteRevisionRef.current = remoteUpdate.revision;
    programmaticDisplay(renditionRef.current, (remoteUpdate.location as EpubLocation).cfi);
  }, [remoteUpdate]);

  useEffect(() => {
    if (!ready || !renditionRef.current) return;
    applyAppearance(renditionRef.current, settings);
  }, [ready, settings.theme, settings.fontFamily, settings.fontSize, settings.lineHeight, settings.padding]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!outlineTarget || !renditionRef.current) return;
    // A TOC click IS a real user navigation — publish it (not suppressed),
    // and treat it as discrete so it syncs immediately rather than waiting
    // out the debounce.
    if (outlineTarget.href) {
      discreteRef.current = true;
      renditionRef.current.display(outlineTarget.href);
    }
    onOutlineTargetHandled();
  }, [outlineTarget, onOutlineTargetHandled]);

  useEffect(() => {
    if (!focusAnnotationId) return;
    const target = annotations.find((a) => a.id === focusAnnotationId && a.locationType === 'epub');
    if (target && renditionRef.current) {
      // Reviewing an annotation from the panel is a "peek", not "I'm now
      // reading from here" — suppress so it doesn't move the synced
      // bookmark on other devices.
      programmaticDisplay(renditionRef.current, (target.location as EpubAnnotationLocation).cfiRange);
    }
    onFocusHandled();
  }, [focusAnnotationId, annotations, onFocusHandled]);

  // Keyboard page turns when focus is on the outer page rather than inside
  // the currently-rendered chapter iframe (e.g. right after opening the
  // book, before the reader has been clicked into). Skipped while focus is
  // in a text input (the search box) so arrow keys type normally there.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (settings.mode !== 'paginated' || !renditionRef.current) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        discreteRef.current = true;
        renditionRef.current.next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        discreteRef.current = true;
        renditionRef.current.prev();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settings.mode]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!ready || !rendition) return;
    const epubAnnotations = annotations.filter((a) => a.locationType === 'epub');
    const nextKeys = new Set(epubAnnotations.map((a) => `${(a.location as EpubAnnotationLocation).cfiRange}:${a.color}`));

    for (const key of highlightsRef.current) {
      if (!nextKeys.has(key)) {
        const [cfiRange] = key.split(':');
        try {
          rendition.annotations.remove(cfiRange, 'highlight');
        } catch {
          // already gone
        }
      }
    }
    for (const a of epubAnnotations) {
      const cfiRange = (a.location as EpubAnnotationLocation).cfiRange;
      const key = `${cfiRange}:${a.color}`;
      if (!highlightsRef.current.has(key)) {
        try {
          rendition.annotations.highlight(cfiRange, {}, undefined, 'epub-highlight', {
            fill: COLOR_VAR[a.color],
            'fill-opacity': '0.4',
            'mix-blend-mode': 'multiply',
          });
        } catch {
          // a stale CFI from a since-edited book — skip rather than crash the reader
        }
      }
    }
    highlightsRef.current = nextKeys;
  }, [annotations, ready]);

  function confirmHighlight(color: AnnotationColor) {
    if (!selection) return;
    onCreateAnnotation({
      type: 'highlight',
      color,
      locationType: 'epub',
      location: { cfiRange: selection.cfiRange, chapterHref: currentHrefRef.current },
      selectedText: selection.text,
    });
    selection.contents.window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.viewport}>
        <div ref={containerRef} className={`${styles.container} ${settings.mode === 'continuous' ? styles.containerScrolled : ''}`} />
        {!ready && <div className={styles.centered}>Opening book…</div>}
        {ready && settings.mode === 'paginated' && (
          <>
            <button
              type="button"
              className={`${styles.navZone} ${styles.navZoneLeft}`}
              aria-label="Previous page"
              onClick={() => {
                onActivity();
                discreteRef.current = true;
                renditionRef.current?.prev();
              }}
            />
            <button
              type="button"
              className={`${styles.navZone} ${styles.navZoneRight}`}
              aria-label="Next page"
              onClick={() => {
                onActivity();
                discreteRef.current = true;
                renditionRef.current?.next();
              }}
            />
          </>
        )}
        {selection && <HighlightPopup x={selection.x} y={selection.y} onPick={confirmHighlight} />}
      </div>

      <div className={`${styles.progressRow} ${controlsVisible ? '' : styles.progressHidden}`}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <span className={styles.progressLabel}>{Math.round(progress * 100)}%</span>
      </div>

      <EpubSearchOverlay
        book={bookForSearch}
        annotations={annotations}
        open={searchOpen}
        onClose={() => onSearchOpenChange(false)}
        onJump={(cfi) => {
          discreteRef.current = true;
          renditionRef.current?.display(cfi);
        }}
      />
    </div>
  );
}
