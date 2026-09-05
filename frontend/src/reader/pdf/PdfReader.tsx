import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { ReaderComponentProps } from '../types';
import type { AnnotationColor, PdfAnnotationLocation, PdfLocation } from '../../types';
import { books } from '../../services/api';
import { usePdfDocument } from './usePdfDocument';
import PdfPage, { type PendingPdfSelection, type SearchMatchOnPage } from './PdfPage';
import HighlightPopup from './HighlightPopup';
import PdfSearchOverlay, { type PdfSearchResult } from './PdfSearchOverlay';
import type { PdfSearchMatch } from './search';
import { useReadingSessionTracker } from '../analytics/useReadingSessionTracker';
import { useNotebookPages } from '../notebook/useNotebookPages';
import NotebookPageBlock from './NotebookPageBlock';
import styles from './PdfReader.module.css';

const PRELOAD_MARGIN = '1200px 0px';

export default function PdfReader({
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
  const { doc, numPages, toc, error } = usePdfDocument(books.fileUrl(book.id));

  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<number, HTMLDivElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [basePageSize, setBasePageSize] = useState<{ width: number; height: number } | null>(null);
  const [activePages, setActivePages] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [selection, setSelection] = useState<PendingPdfSelection | null>(null);
  const [activeSearchMatch, setActiveSearchMatch] = useState<{ page: number; rects: PdfSearchMatch['rects'] } | null>(null);

  // Both the document and page 1's intrinsic size (fetched by a separate
  // effect below) must be ready before pages can actually mount/measure.
  const ready = !!doc && !!basePageSize;

  useReadingSessionTracker(book.id, numPages ? currentPage / numPages : 0);

  // Blank notebook pages (typed text + freehand ink) interleaved between
  // real PDF pages — continuous mode only (see notebookPagesByAfter below).
  const { pages: notebookPages, create: createNotebookPage, update: updateNotebookPage, remove: removeNotebookPage } = useNotebookPages(book.id);
  const notebookPagesByAfter = useMemo(() => {
    const map = new Map<number, typeof notebookPages>();
    for (const p of notebookPages) {
      const key = p.location.afterPage;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [notebookPages]);

  // ==========================================================================
  // LOOP PREVENTION — mirrors the pattern in reader/epub/EpubReader.tsx.
  // Scrolling (continuous mode) and setCurrentPage (paginated mode) are used
  // BOTH for real user navigation and for applying initialPosition/
  // remoteUpdate/a mode switch programmatically. `suppressRef` marks the
  // next position-tracking tick as one to swallow instead of publish; a
  // timer bounds it in case the programmatic jump lands on the page that
  // was already current (which fires no scroll/observer change at all, so
  // there'd be nothing to naturally clear the flag).
  // ==========================================================================
  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedRevisionRef = useRef<number | null>(null);
  const appliedRemoteRevisionRef = useRef<number | null>(null);

  // A stable no-op — PdfPage's render effect depends on `onMeasured`, so an
  // inline `() => {}` here would give it a new identity every PdfReader
  // re-render (which happens on every scroll tick via `currentPage`), and
  // that would re-run — and re-cancel — every active page's canvas/text
  // layer render on every tick. Individual pages self-correct their own
  // placeholder size (see PdfPage's `size` state); PdfReader doesn't need
  // to hear about it, but the callback identity still has to be stable.
  const handleMeasured = useCallback(() => {}, []);

  function suppressNextPositionTick() {
    suppressRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => (suppressRef.current = false), 500);
  }

  useEffect(() => {
    if (toc.length || doc) onOutlineLoaded(toc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc, doc]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  // Container size (drives fit-width/fit-page scale computation).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setContainerSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Page 1's intrinsic size at scale 1 — used as the uniform-page estimate
  // for every page's placeholder and for fit-width/fit-page math. Real
  // per-page rendering still self-corrects an individual non-uniform page
  // (see PdfPage's own `size` state).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc.getPage(1).then((page: PDFPageProxy) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: 1 });
      setBasePageSize({ width: vp.width, height: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const scale = useMemo(() => {
    if (!basePageSize) return 1;
    const availWidth = Math.max(200, containerSize.width - settings.padding.left - settings.padding.right);
    const availHeight = Math.max(200, containerSize.height - settings.padding.top - settings.padding.bottom);
    if (settings.pdfZoom === 'fit-width') return availWidth / basePageSize.width;
    if (settings.pdfZoom === 'fit-page') return availHeight / basePageSize.height;
    return typeof settings.pdfZoom === 'number' ? settings.pdfZoom : 1;
  }, [basePageSize, containerSize, settings.pdfZoom, settings.padding]);

  const placeholderWidth = basePageSize ? basePageSize.width * scale : 0;
  const placeholderHeight = basePageSize ? basePageSize.height * scale : 0;

  // Shared IntersectionObserver drives both virtualization (which pages get
  // a real canvas/text-layer render) and — restricted to the continuous
  // scroll list — "which page is the user currently on".
  //
  // `ready` MUST be a dependency here even though the effect body only
  // reads `scrollAreaRef.current`: the scroll area (and thus the ref) only
  // exists in the DOM once `ready` flips true, which happens on a LATER
  // render than the one where `numPages` first became truthy (it also
  // needs `basePageSize`, resolved by a separate async effect). Without
  // `ready` in the deps, this effect's first real run finds the ref still
  // null, bails out, and — since numPages/mode don't change again — never
  // gets a second chance to actually create the observer, leaving every
  // page permanently inactive (no canvas ever renders).
  useEffect(() => {
    if (settings.mode !== 'continuous' || !ready || !scrollAreaRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setActivePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root: scrollAreaRef.current, rootMargin: PRELOAD_MARGIN, threshold: 0 }
    );
    observerRef.current = observer;
    for (const el of nodesRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [settings.mode, numPages, ready]);

  const registerNode = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) {
      nodesRef.current.set(page, el);
      observerRef.current?.observe(el);
    } else {
      const existing = nodesRef.current.get(page);
      if (existing) observerRef.current?.unobserve(existing);
      nodesRef.current.delete(page);
    }
  }, []);

  // Tracks "current page" from scroll position (continuous mode) among
  // whichever pages the observer currently reports as active — never a
  // full scan of the whole document.
  useEffect(() => {
    if (settings.mode !== 'continuous') return;
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    let ticking = false;

    function computeCurrentPage() {
      ticking = false;
      // "Current page" = whichever active page occupies the most vertical
      // space in the viewport right now — NOT "the first page whose top
      // has scrolled past some threshold". The old threshold approach
      // would call a page "current" the instant even a sliver of it
      // touched the top of the view, so a barely-visible page (a couple
      // pixels peeking in at the bottom of the screen) could get synced
      // as the reading position. Ranking by visible height instead means
      // the page filling most of the screen always wins, which is what
      // "where the user is actually reading" should mean.
      const containerRect = scrollArea!.getBoundingClientRect();
      let best: { page: number; visible: number } | null = null;
      for (const page of activePages) {
        const el = nodesRef.current.get(page);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const visible = Math.max(0, Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top));
        if (visible > 0 && (!best || visible > best.visible)) best = { page, visible };
      }
      if (best && best.page !== currentPage) {
        setCurrentPage(best.page);
        if (suppressRef.current) {
          suppressRef.current = false;
          if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
        } else {
          // This branch only ever runs for genuine user scrolling: every
          // goToPage-initiated jump unconditionally suppresses it (see
          // goToPage below), so there's no "discrete" case to handle here
          // — it's always the debounced path, same as continuous scrolling
          // always should be.
          const loc: PdfLocation = { page: best.page, scrollOffset: 0 };
          onLocalPositionChange('pdf-page', loc, numPages ? best.page / numPages : 0);
        }
      }
    }

    function onScroll() {
      onActivity();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(computeCurrentPage);
    }
    scrollArea.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollArea.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, activePages, currentPage, numPages]);

  function goToPage(page: number, opts?: { discrete?: boolean; suppress?: boolean }) {
    const clamped = Math.max(1, Math.min(numPages || 1, page));
    if (settings.mode === 'paginated') {
      setCurrentPage(clamped);
      if (opts?.discrete && !opts?.suppress) {
        const loc: PdfLocation = { page: clamped, scrollOffset: 0 };
        onLocalPositionChange('pdf-page', loc, numPages ? clamped / numPages : 0, { immediate: true });
      }
    } else {
      // Continuous mode: always suppress the scroll-tracking effect's own
      // detection for a goToPage-initiated jump, discrete or not. goToPage
      // is the single source of truth for whether/how THIS transition
      // gets published (right below) — letting the scroll handler also
      // react to the resulting scroll event would either double-publish or
      // race the state update that already happened here.
      suppressNextPositionTick();
      const el = nodesRef.current.get(clamped);
      el?.scrollIntoView({ block: 'start' });
      setCurrentPage(clamped);
      if (opts?.discrete && !opts?.suppress) {
        const loc: PdfLocation = { page: clamped, scrollOffset: 0 };
        onLocalPositionChange('pdf-page', loc, numPages ? clamped / numPages : 0, { immediate: true });
      }
    }
  }

  // Apply the authoritative starting position once the document + base
  // page size are both ready. Never publishes (see loop-prevention header).
  useEffect(() => {
    if (!ready || !initialPosition) return;
    if (appliedRevisionRef.current === initialPosition.revision) return;
    appliedRevisionRef.current = initialPosition.revision;
    goToPage((initialPosition.location as PdfLocation).page, { suppress: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialPosition]);

  useEffect(() => {
    if (!ready || !remoteUpdate) return;
    if (appliedRemoteRevisionRef.current === remoteUpdate.revision) return;
    appliedRemoteRevisionRef.current = remoteUpdate.revision;
    goToPage((remoteUpdate.location as PdfLocation).page, { suppress: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, remoteUpdate]);

  useEffect(() => {
    // `ready` matters here (see the equivalent comment in EpubReader.tsx):
    // a target set before the document/pages exist — e.g. a library-search
    // jump landing on a fresh page load — must wait and retry once ready,
    // not be silently dropped the instant goToPage's node lookup misses.
    if (!ready || !outlineTarget) return;
    if (outlineTarget.page != null) goToPage(outlineTarget.page, { discrete: true });
    onOutlineTargetHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, outlineTarget]);

  useEffect(() => {
    if (!focusAnnotationId) return;
    const target = annotations.find((a) => a.id === focusAnnotationId && a.locationType === 'pdf');
    if (target) goToPage((target.location as PdfAnnotationLocation).page, { suppress: true });
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAnnotationId]);

  // Keyboard navigation for paginated mode (continuous mode gets this for
  // free from native scrolling).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || settings.mode !== 'paginated') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(currentPage + 1, { discrete: true });
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(currentPage - 1, { discrete: true });
      else if (e.key === 'Home') goToPage(1, { discrete: true });
      else if (e.key === 'End') goToPage(numPages, { discrete: true });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, currentPage, numPages]);

  // Touch swipe for paginated mode.
  const touchStartXRef = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartXRef.current = e.changedTouches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartXRef.current == null || settings.mode !== 'paginated') return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartXRef.current) - touchStartXRef.current;
    touchStartXRef.current = null;
    if (dx <= -40) goToPage(currentPage + 1, { discrete: true });
    else if (dx >= 40) goToPage(currentPage - 1, { discrete: true });
  }

  // Dismiss the highlight-creation popup on any click outside it, without
  // swallowing the click that opens a color swatch (mousedown there calls
  // preventDefault but still bubbles).
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selection) return;
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setSelection(null);
    }
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [selection]);

  function confirmHighlight(color: AnnotationColor) {
    if (!selection) return;
    onCreateAnnotation({
      type: 'highlight',
      color,
      locationType: 'pdf',
      location: { page: selection.page, rects: selection.rects, contextBefore: selection.contextBefore, contextAfter: selection.contextAfter },
      selectedText: selection.text,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function jumpToSearchMatch(match: PdfSearchResult) {
    if (match.kind === 'text') setActiveSearchMatch({ page: match.page, rects: match.rects });
    // An annotation match has no rects of its own to overlay (it's already
    // rendered as a highlight on the page) — just navigate to it.
    goToPage(match.page, { discrete: true });
  }

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, typeof annotations>();
    for (const a of annotations) {
      if (a.locationType !== 'pdf') continue;
      const page = (a.location as PdfAnnotationLocation).page;
      if (!map.has(page)) map.set(page, []);
      map.get(page)!.push(a);
    }
    return map;
  }, [annotations]);

  function searchMatchesFor(page: number): SearchMatchOnPage[] {
    if (!activeSearchMatch || activeSearchMatch.page !== page) return [];
    return [{ rects: activeSearchMatch.rects, active: true }];
  }

  if (error) return null; // onError already reported; ReaderPage renders the banner

  return (
    <div ref={wrapRef} className={styles.wrap} data-theme={settings.theme} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {!ready && <div className={styles.centered}>Opening book…</div>}

      {ready && settings.mode === 'continuous' && (
        <div
          ref={scrollAreaRef}
          className={styles.scrollArea}
          style={{ padding: `${settings.padding.top}px ${settings.padding.right}px ${settings.padding.bottom}px ${settings.padding.left}px` }}
          onMouseMove={onActivity}
        >
          <div className={styles.pageList}>
            <button type="button" className={styles.insertPageButton} onClick={() => createNotebookPage(0)}>
              + Notebook page
            </button>
            {(notebookPagesByAfter.get(0) ?? []).map((np) => (
              <NotebookPageBlock key={np.id} page={np} width={placeholderWidth} height={placeholderHeight} onUpdate={updateNotebookPage} onDelete={removeNotebookPage} />
            ))}
            {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
              <Fragment key={page}>
                <PdfPage
                  doc={doc!}
                  pageNumber={page}
                  scale={scale}
                  active={activePages.has(page)}
                  placeholderWidth={placeholderWidth}
                  placeholderHeight={placeholderHeight}
                  onMeasured={handleMeasured}
                  registerNode={registerNode}
                  highlights={highlightsByPage.get(page) ?? []}
                  focusedAnnotationId={focusAnnotationId}
                  searchMatches={searchMatchesFor(page)}
                  onSelectionCreated={setSelection}
                />
                <button type="button" className={styles.insertPageButton} onClick={() => createNotebookPage(page)}>
                  + Notebook page
                </button>
                {(notebookPagesByAfter.get(page) ?? []).map((np) => (
                  <NotebookPageBlock key={np.id} page={np} width={placeholderWidth} height={placeholderHeight} onUpdate={updateNotebookPage} onDelete={removeNotebookPage} />
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {ready && settings.mode === 'paginated' && (
        <div
          className={styles.paginatedViewport}
          style={{ padding: `${settings.padding.top}px ${settings.padding.right}px ${settings.padding.bottom}px ${settings.padding.left}px` }}
          onMouseMove={onActivity}
        >
          <PdfPage
            key={currentPage}
            doc={doc!}
            pageNumber={currentPage}
            scale={scale}
            active
            placeholderWidth={placeholderWidth}
            placeholderHeight={placeholderHeight}
            onMeasured={handleMeasured}
            registerNode={() => {}}
            highlights={highlightsByPage.get(currentPage) ?? []}
            focusedAnnotationId={focusAnnotationId}
            searchMatches={searchMatchesFor(currentPage)}
            onSelectionCreated={setSelection}
          />
          <button type="button" className={`${styles.navZone} ${styles.navZoneLeft}`} aria-label="Previous page" onClick={() => goToPage(currentPage - 1, { discrete: true })} />
          <button type="button" className={`${styles.navZone} ${styles.navZoneRight}`} aria-label="Next page" onClick={() => goToPage(currentPage + 1, { discrete: true })} />
        </div>
      )}

      {selection && (
        <div ref={popupRef}>
          <HighlightPopup x={selection.x} y={selection.y} onPick={confirmHighlight} />
        </div>
      )}

      <div className={`${styles.progressRow} ${controlsVisible ? '' : styles.progressHidden}`}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: numPages ? `${(currentPage / numPages) * 100}%` : '0%' }} />
        </div>
        <span className={styles.progressLabel}>
          Page {currentPage} of {numPages || '–'}
        </span>
      </div>

      <PdfSearchOverlay doc={doc} numPages={numPages} annotations={annotations} open={searchOpen} onClose={() => onSearchOpenChange(false)} onJump={jumpToSearchMatch} />
    </div>
  );
}
