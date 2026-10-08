import { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';
import type Contents from 'epubjs/types/contents';
import type { ReaderComponentProps } from '../types';
import type { AnnotationColor, EpubAnnotationLocation, EpubLocation } from '../../types';
import { registerThemes, applyTheme, applyTypography } from './themes';
import { navItemsToToc } from './toc';
import HighlightPopup, { COLOR_VAR } from './HighlightPopup';
import EpubSearchOverlay from './EpubSearchOverlay';
import { useReadingSessionTracker } from '../analytics/useReadingSessionTracker';
import { clampPadding, useViewportSize } from '../padding';
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
  fileUrl,
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

  // The reader fills the window, so the window is the box the padding has to
  // fit inside. Clamped rather than used raw: the sliders deliberately reach
  // far past any phone's width (one setting has to serve a phone and a
  // desktop), and an unclamped value would leave no page to read.
  const viewport = useViewportSize();
  const pad = clampPadding(settings.padding, viewport.width, viewport.height);

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
  // True while a chapter change is in flight, so one overscroll gesture
  // cannot fire a burst of them.
  const crossingRef = useRef(false);
  const pullHintRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [bookForSearch, setBookForSearch] = useState<Book | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const pendingEpubSelectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useReadingSessionTracker(book.id, progress);

  function programmaticDisplay(rendition: Rendition, target?: string) {
    // A TOC jump or a remote sync can land mid-gesture; don't leave the
    // chapter parked at whatever offset/opacity the rubber band or a
    // crossChapter reveal (see the rendition effect below) was holding it
    // at — display() replaces the section outright, so any of those
    // in-flight inline styles would otherwise survive onto content they
    // were never meant to apply to.
    const scroller = containerRef.current?.querySelector('.epub-container') as HTMLElement | null;
    if (scroller) {
      scroller.style.transition = '';
      scroller.style.transform = '';
      scroller.style.opacity = '';
      scroller.style.visibility = '';
    }
    suppressRelocateRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressRelocateRef.current = false;
    }, 800);
    return rendition.display(target);
  }

  // Restoring a saved position needs one extra step: a section's iframe
  // reports its height in stages as it lays out, and a scroll to a spot
  // deep inside it lands clamped against whatever height it had at that
  // moment — dropping the reader at the chapter's start instead of where
  // they left off. Re-assert the target as the layout settles. Displaying
  // an already-rendered section is just a scroll, so this is cheap.
  function restoreDisplay(rendition: Rendition, cfi: string) {
    programmaticDisplay(rendition, cfi);
    const again = () => {
      if (renditionRef.current !== rendition) return;
      programmaticDisplay(rendition, cfi);
    };
    setTimeout(again, 250);
    setTimeout(again, 700);
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

    // `openAs: 'epub'` is required even though this is a local blob: URL —
    // arguably more so. epub.js's input-type detection (Book#determineType)
    // looks at the URL's file extension to decide between unzipping a packed
    // archive and treating the URL as an already-exploded directory of
    // files, and a blob: URL has no extension at all. Without it, epub.js
    // silently picks "directory" and GETs paths like META-INF/container.xml
    // relative to the blob URL — all of which fail — and the book never
    // finishes opening, since that isn't a rejection epub.js surfaces.
    const epubBook = ePub(fileUrl, { openAs: 'epub' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    epubBookRef.current = epubBook;
    setBookForSearch(epubBook);

    epubBook.loaded.navigation
      .then((nav) => {
        if (!cancelled) onOutlineLoaded(navItemsToToc(nav.toc));
      })
      .catch(() => {});

    // Book-wide locations give an exact % but generating them walks the
    // entire book's text on the main thread — on a long book that is seconds
    // of work, and it used to land exactly while the reader was starting to
    // scroll, as stutter. So it runs once per book per device: the result is
    // saved and every later open just loads it. The first open defers the
    // walk until the reader has been idle for a moment, and the 'relocated'
    // handler below estimates progress until it's done.
    const locationsKey = `syncer:epub-locations:${book.id}`;
    let generateTimer: ReturnType<typeof setTimeout> | undefined;
    epubBook.ready
      .then(() => {
        if (cancelled) return;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(locationsKey);
        } catch {
          // ignore
        }
        if (saved) {
          epubBook.locations.load(saved);
          return;
        }
        generateTimer = setTimeout(() => {
          const run = () => {
            if (cancelled) return;
            epubBook.locations
              .generate(1600)
              .then(() => {
                try {
                  localStorage.setItem(locationsKey, epubBook.locations.save());
                } catch {
                  // quota — it'll just be regenerated next time
                }
              })
              .catch(() => {});
          };
          if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 });
          else run();
        }, 3000);
      })
      .catch(() => {});

    epubBook.opened.catch(() => {
      if (!cancelled) onError('This EPUB could not be opened. It may be corrupted or invalid.');
    });

    return () => {
      cancelled = true;
      clearTimeout(generateTimer);
      epubBook.destroy();
      epubBookRef.current = null;
    };
  }, [book.id, fileUrl]);

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
      // Always the default manager, which renders exactly ONE section at a
      // time and never touches scroll position. epub.js's 'continuous'
      // manager is the one that stitches sections into a single endless
      // scroll, and it was used here for that reason — but it keeps the
      // scroll offset stable across section loads by prepending/erasing
      // views and compensating scrollTop by hand, and that machinery races
      // itself badly once you are deep in a long book: a table-of-contents
      // jump lands a chapter early (it prepends the previous section under
      // you), scrolling gets pulled back and forth inside a two or three
      // chapter band instead of advancing, and at some boundaries it tears
      // the DOM outright ("removeChild: node is not a child"), after which
      // the reader stops responding to anything at all. Chaining sections
      // ourselves (see crossChapter below) costs a visible chapter break
      // but is deterministic and cannot fight the scroller.
      manager: 'default',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    registerThemes(rendition);
    applyTheme(rendition, settings);
    applyTypography(rendition, settings);

    rendition.on(
      'relocated',
      (location: { start: { cfi: string; href: string; index: number; displayed?: { page: number; total: number } } }) => {
        const cfi = location.start.cfi;
        const href = location.start.href;
        currentHrefRef.current = href;
        currentCfiRef.current = cfi;
        let pct = 0;
        try {
          // `locations.length()` reflects the array epub.js fills in
          // DURING `generate()` (kicked off below), so it's already > 0
          // long before generation actually finishes — but `.total` (the
          // denominator `percentageFromCfi` divides by) is only set once
          // generation fully completes. Checking `.length()` instead of
          // `.total` routed here too early and got a hard 0 back from
          // `percentageFromLocation` (`if (!this.total) return 0`) for
          // every relocate in between, which pinned this progress bar at
          // 0% for every page turn on a long book — looking "stuck" — for
          // as long as generation was still running.
          // `.total` isn't in epub.js's bundled Locations type.
          const locationsReady = ((epubBook.locations as any)?.total ?? 0) > 0; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (locationsReady) {
            // Book-wide locations are ready — exact percentage.
            pct = epubBook.locations.percentageFromCfi(cfi);
          } else {
            // Estimate instead from the current chapter's position in the
            // spine plus how far through that chapter we are, so the bar
            // keeps moving live instead of sitting at 0% the whole time.
            // Not in epub.js's bundled Spine type, but set at runtime once
            // the book's package document is parsed (see spine.js).
            const spineLength = (epubBook.spine as any)?.length || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
            const sectionFraction =
              location.start.displayed && location.start.displayed.total
                ? (location.start.displayed.page - 1) / location.start.displayed.total
                : 0;
            pct = (location.start.index + sectionFraction) / spineLength;
          }
        } catch {
          // leave pct at whatever was computed above
        }
        // Rounded so a scroll that doesn't move the visible percentage
        // doesn't re-render the reader either.
        setProgress(Math.round(pct * 1000) / 1000);

        if (suppressRelocateRef.current) {
          suppressRelocateRef.current = false;
          if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
          return; // REMOTE_SYNC_UPDATE or a non-navigation redisplay — never republish
        }

        const loc: EpubLocation = { cfi, chapterHref: href, scrollOffset: 0 };
        const opts = discreteRef.current ? { immediate: true } : undefined;
        discreteRef.current = false;
        onLocalPositionChange('epub-cfi', loc, pct, opts);
      }
    );

    // epub.js already waits 250ms after the selection settles before firing
    // this at all; we add a further gap on top and re-check the selection is
    // still exactly what it was when the timer fires, so a plain tap that
    // momentarily selects a word (mobile tap-to-select-word) doesn't pop the
    // highlight picker up before the user's finger has even left the screen.
    rendition.on('selected', (cfiRange: string, contents: Contents) => {
      const text = contents.window.getSelection()?.toString().trim() ?? '';
      if (!text) return;
      if (pendingEpubSelectionTimer.current) clearTimeout(pendingEpubSelectionTimer.current);
      pendingEpubSelectionTimer.current = setTimeout(() => {
        pendingEpubSelectionTimer.current = null;
        const sel = contents.window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        if (sel.toString().trim() !== text) return;
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
      }, 300);
    });

    // Dismiss the highlight-creation popup on a tap anywhere else — inside
    // the book content (forwarded from whichever iframe is current) or
    // outside it (chrome, nav zones). The popup itself renders in the main
    // document, so a tap on it never reaches these handlers as "outside".
    function dismissIfOutside(e: Event) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setSelection(null);
    }
    rendition.on('mousedown', dismissIfOutside);
    rendition.on('touchstart', dismissIfOutside);
    window.addEventListener('mousedown', dismissIfOutside);
    window.addEventListener('touchstart', dismissIfOutside, { passive: true });

    // ------------------------------------------------------------------
    // Chapter chaining for scrolled mode (see the `manager` note above).
    // The scroller is the element epub.js builds inside our container; it
    // holds one section sized to its full content height. Scrolling within
    // a chapter is therefore plain native scrolling, and only crossing a
    // chapter boundary needs us. We require an actual input gesture past
    // the edge rather than merely *being* at the edge, so that landing at
    // the top of a chapter (every jump does) can never bounce us into the
    // previous one, and so the reader can rest at either end.
    // ------------------------------------------------------------------
    function scrollerEl(): HTMLElement | null {
      return (containerRef.current?.querySelector('.epub-container') as HTMLElement | null) ?? null;
    }

    // Crossing a chapter is a deliberate, visible step here rather than a
    // seamless stitch, so it gets a deliberate, visible transition: content
    // follows the finger past the edge against rising resistance, slides the
    // rest of the way out on release, and the next chapter fades/slides in
    // behind it. Purely cosmetic — the transform/opacity never touch scroll
    // position, so none of the navigation logic below depends on it.
    // Deliberately stiff. Reaching the end of a chapter and carrying on
    // scrolling a little must never turn the page — only a clear, sustained
    // pull past the edge does. The hint (pullHintRef) shows how far along
    // that pull is, so it never feels like nothing is happening either.
    const PULL_MAX_PX = 120; // asymptote: the band never stretches past this
    const PULL_COMMIT_PX = 150; // raw finger travel past the edge that turns the page
    const WHEEL_COMMIT_PX = 420; // accumulated wheel/trackpad delta past the edge
    // A wheel stream with no gap this long since reaching the edge is the
    // momentum of the scroll that got there, not a new intent to go further.
    const WHEEL_NEW_GESTURE_GAP_MS = 220;
    const WHEEL_RELEASE_MS = 260; // wheel pause that ends a pull
    const SLIDE_OUT_PX = 36;
    const SLIDE_IN_PX = 48;
    const SLIDE_OUT_MS = 130;
    const SLIDE_IN_MS = 320;
    const SPRING_BACK_MS = 280;
    const SETTLE_MAX_WAIT_MS = 500;
    const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

    // Asymptotic: the first pixels move nearly freely, the last barely at
    // all, so the band feels like it's tightening against a stop.
    const damp = (raw: number) => PULL_MAX_PX * (1 - Math.exp(-raw / PULL_MAX_PX));

    function showPullHint(direction: 1 | -1, fraction: number) {
      const hint = pullHintRef.current;
      if (!hint) return;
      const ready = fraction >= 1;
      const label = direction === 1 ? (ready ? 'Release for next chapter' : 'Keep pulling for next chapter') : ready ? 'Release for previous chapter' : 'Keep pulling for previous chapter';
      if (hint.textContent !== label) hint.textContent = label;
      hint.dataset.edge = direction === 1 ? 'bottom' : 'top';
      hint.dataset.ready = ready ? 'true' : 'false';
      hint.style.opacity = String(Math.min(1, 0.25 + fraction));
    }

    function hidePullHint() {
      const hint = pullHintRef.current;
      if (hint) hint.style.opacity = '0';
    }

    function setPull(el: HTMLElement, y: number, ms: number) {
      el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
      el.style.transform = `translateY(${y}px)`;
    }

    function clearPull(el: HTMLElement) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.style.visibility = '';
    }

    // A section's iframe reports its height in stages as it lays out
    // (images decoding, fonts swapping in), so right after rendition.next()/
    // prev() resolves, scrollHeight can still be climbing for a few frames.
    // Reveal too early and the reader visibly sees that settling — the
    // "slide in" arrives already wrong and then jumps around as it stabilizes,
    // which is exactly the "one instance one page, another instance another
    // page" snap this replaces. So this waits for scrollHeight to hold
    // steady across a couple of frames (re-pinning to the bottom each frame
    // when going backwards, since that's where a backward landing belongs)
    // before the caller reveals anything — capped so a slow/huge chapter
    // still resolves the transition rather than hanging.
    function waitForSettledHeight(target: HTMLElement, pinBottom: boolean): Promise<void> {
      return new Promise((resolve) => {
        const start = performance.now();
        let lastHeight = -1;
        let stableFrames = 0;
        function check() {
          const el = scrollerEl();
          if (cancelled || renditionRef.current !== rendition || el !== target) {
            resolve();
            return;
          }
          if (pinBottom) el.scrollTop = el.scrollHeight;
          const h = el.scrollHeight;
          stableFrames = h === lastHeight ? stableFrames + 1 : 0;
          lastHeight = h;
          if (stableFrames >= 2 || performance.now() - start >= SETTLE_MAX_WAIT_MS) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    }

    function crossChapter(direction: 1 | -1) {
      if (crossingRef.current) return;
      crossingRef.current = true;
      hidePullHint();
      // A chapter change is real user navigation — sync it immediately
      // rather than waiting out the position-publish debounce.
      discreteRef.current = true;

      // Carry the pull through into a short slide-out, so release continues
      // the gesture instead of cutting away from it.
      const outgoing = scrollerEl();
      if (outgoing) setPull(outgoing, direction === 1 ? -SLIDE_OUT_PX : SLIDE_OUT_PX, SLIDE_OUT_MS);

      setTimeout(() => {
        if (cancelled) return;
        Promise.resolve(direction === 1 ? rendition.next() : rendition.prev())
          .then(async () => {
            if (cancelled) return;
            const entering = scrollerEl();
            if (!entering) return;

            // Hide and position the new chapter before anything about the
            // swap is visible — no flash of its wrong initial state, no
            // visible re-pinning while it settles.
            entering.style.transition = 'none';
            entering.style.transform = 'none';
            entering.style.opacity = '0';
            entering.style.visibility = 'hidden';
            if (direction === -1) {
              entering.scrollTop = entering.scrollHeight;
            } else {
              entering.scrollTop = 0;
            }
            await waitForSettledHeight(entering, direction === -1);
            if (cancelled || renditionRef.current !== rendition) return;

            // Now reveal with a real, visible crossfade + slide from the
            // direction of travel — the content underneath is already
            // correct and settled, so this motion is the only thing that
            // changes, not a race against layout still catching up.
            const el = scrollerEl();
            if (!el) return;
            el.style.transform = `translateY(${direction === 1 ? SLIDE_IN_PX : -SLIDE_IN_PX}px)`;
            el.style.visibility = 'visible';
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const el2 = scrollerEl();
                if (!el2) return;
                el2.style.transition = `transform ${SLIDE_IN_MS}ms ${EASE}, opacity ${SLIDE_IN_MS}ms ${EASE}`;
                el2.style.transform = 'translateY(0)';
                el2.style.opacity = '1';
              })
            );
            setTimeout(() => {
              const el3 = scrollerEl();
              if (el3) clearPull(el3);
            }, SLIDE_IN_MS + 80);
          })
          .catch((err) => {
            // Nothing to move to (first/last section) is the expected case
            // and rejects too — but epub.js's manager.next()/prev() can also
            // reject on a genuine content-loading error, which looked
            // identical to "no more chapters" from here. Logging it turns a
            // silent no-op into something diagnosable.
            console.error('epub chapter navigation failed', err);
            const el = scrollerEl();
            if (el) setPull(el, 0, SPRING_BACK_MS);
          })
          .finally(() => {
            setTimeout(() => (crossingRef.current = false), 400);
          });
      }, SLIDE_OUT_MS);
    }

    const EDGE_SLACK_PX = 4;
    function atEdge(el: HTMLElement, direction: 1 | -1) {
      return direction === 1
        ? el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_SLACK_PX
        : el.scrollTop <= EDGE_SLACK_PX;
    }

    let wheelPull = 0;
    let wheelDir: 0 | 1 | -1 = 0;
    let wheelArmed = false;
    let lastWheelAt = 0;
    let wheelReleaseTimer: ReturnType<typeof setTimeout> | undefined;

    function releaseWheelPull() {
      const el = scrollerEl();
      if (el && wheelPull > 0 && !crossingRef.current) setPull(el, 0, SPRING_BACK_MS);
      if (!crossingRef.current) hidePullHint();
      wheelPull = 0;
      wheelDir = 0;
    }

    function onWheel(e: WheelEvent) {
      if (settings.mode === 'paginated' || e.deltaY === 0 || crossingRef.current) return;
      const el = scrollerEl();
      if (!el) return;
      const now = performance.now();
      const gap = now - lastWheelAt;
      lastWheelAt = now;
      const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;

      if (!atEdge(el, direction)) {
        // Still scrolling through the chapter. Disarm, so the momentum that
        // carries this scroll into the edge can't count as a pull.
        wheelArmed = false;
        if (wheelPull) releaseWheelPull();
        return;
      }
      // Only a fresh gesture that starts while already resting at the edge
      // counts toward turning the page.
      if (!wheelArmed) {
        if (gap < WHEEL_NEW_GESTURE_GAP_MS) return;
        wheelArmed = true;
      }
      if (wheelDir !== direction) {
        wheelPull = 0;
        wheelDir = direction;
      }
      // deltaMode 1 = lines (Firefox with a mouse wheel), 2 = pages.
      const px = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      wheelPull += px;
      setPull(el, (direction === 1 ? -1 : 1) * damp(wheelPull * (PULL_COMMIT_PX / WHEEL_COMMIT_PX)), 0);
      showPullHint(direction, wheelPull / WHEEL_COMMIT_PX);

      clearTimeout(wheelReleaseTimer);
      if (wheelPull >= WHEEL_COMMIT_PX) {
        wheelPull = 0;
        wheelDir = 0;
        wheelArmed = false;
        crossChapter(direction);
        return;
      }
      wheelReleaseTimer = setTimeout(releaseWheelPull, WHEEL_RELEASE_MS);
    }

    rendition.on('rendered', (_section: unknown, view: { document?: Document }) => {
      const doc = view?.document;
      if (!doc) return;
      const wake = () => onActivity();
      doc.addEventListener('mousemove', wake);
      doc.addEventListener('click', wake);
      doc.addEventListener('keydown', wake);
      doc.addEventListener('touchstart', wake);

      if (settings.mode === 'paginated') return;
      // These have to go on the chapter's own document: the section fills
      // the scroller with an iframe, so wheel/touch land inside it and
      // never reach anything we own on the outside.
      doc.addEventListener('wheel', onWheel, { passive: true });
      // Touch drives the rubber band: once a drag runs past the chapter
      // edge, follow the finger with damping so it reads as resistance, and
      // decide on release. These stay passive — we must never block
      // scrolling — which is fine, because at the edge there is no native
      // scrolling left to fight, and overscroll-behavior on the scroller
      // (see the stylesheet) keeps the browser's own overscroll away.
      let touchStartY: number | null = null;
      let touchStartedAtEdge: { forward: boolean; back: boolean } | null = null;
      let pullDir: 0 | 1 | -1 = 0;
      let pullOriginY = 0;
      let rawPull = 0;

      const endPull = () => {
        const el = scrollerEl();
        if (pullDir && rawPull >= PULL_COMMIT_PX) crossChapter(pullDir);
        else if (el && pullDir) {
          setPull(el, 0, SPRING_BACK_MS);
          hidePullHint();
        }
        touchStartY = null;
        pullDir = 0;
        rawPull = 0;
      };

      doc.addEventListener(
        'touchstart',
        (e: TouchEvent) => {
          // Only a drag that *starts* with the chapter already resting at an
          // edge can become a pull — a fling that coasts into the edge and a
          // finger that keeps going never does.
          const el = scrollerEl();
          touchStartedAtEdge = el ? { forward: atEdge(el, 1), back: atEdge(el, -1) } : null;
          touchStartY = e.changedTouches[0]?.clientY ?? null;
          pullDir = 0;
          rawPull = 0;
        },
        { passive: true }
      );
      doc.addEventListener(
        'touchmove',
        (e: TouchEvent) => {
          if (touchStartY == null || crossingRef.current) return;
          const el = scrollerEl();
          if (!el) return;
          const y = e.changedTouches[0]?.clientY ?? touchStartY;

          if (!pullDir) {
            // Dragging the finger UP pulls content up, i.e. reads forward.
            const dy = touchStartY - y;
            if (Math.abs(dy) < 10) return;
            const direction: 1 | -1 = dy > 0 ? 1 : -1;
            if (!atEdge(el, direction)) return; // ordinary scrolling
            if (!touchStartedAtEdge || !(direction === 1 ? touchStartedAtEdge.forward : touchStartedAtEdge.back)) {
              // Scrolled into the edge during this drag — let it rest there.
              touchStartY = null;
              return;
            }
            pullDir = direction;
            pullOriginY = y; // measure the stretch from where it caught
            rawPull = 0;
            return;
          }

          rawPull = pullDir === 1 ? pullOriginY - y : y - pullOriginY;
          if (rawPull <= 0) {
            // Dragged back the other way — let the band go slack.
            rawPull = 0;
            pullOriginY = y;
            setPull(el, 0, 0);
            hidePullHint();
            return;
          }
          setPull(el, pullDir === 1 ? -damp(rawPull) : damp(rawPull), 0);
          showPullHint(pullDir, rawPull / PULL_COMMIT_PX);
        },
        { passive: true }
      );
      doc.addEventListener('touchend', endPull, { passive: true });
      doc.addEventListener('touchcancel', endPull, { passive: true });
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

    // epub.js re-reports the location 20ms after *every* scroll pause, and
    // each report walks the rendered chapter's DOM to build a CFI. During a
    // slow drag that means one heavy walk every few frames — the stutter.
    // Silence its report; ours (the scroll effect below) runs once the
    // scroll has actually settled, in idle time.
    rendition.started
      .then(() => {
        const manager = (rendition as unknown as { manager?: { emit: (type: string, ...args: unknown[]) => void } }).manager;
        if (!manager) return;
        const emit = manager.emit.bind(manager);
        manager.emit = (type: string, ...args: unknown[]) => {
          if (type !== 'scrolled') emit(type, ...args);
        };
      })
      .catch(() => {});

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
      clearTimeout(wheelReleaseTimer);
      rendition.destroy();
      renditionRef.current = null;
      window.removeEventListener('mousedown', dismissIfOutside);
      window.removeEventListener('touchstart', dismissIfOutside);
      if (pendingEpubSelectionTimer.current) clearTimeout(pendingEpubSelectionTimer.current);
    };
    // `fileUrl` is in here even though this effect never reads it, and it's
    // load-bearing: it's what the effect above keys off to create
    // `epubBookRef.current`, and this one bails out when that ref is still
    // null. Any fileUrl change that rebuilds the Book therefore has to
    // rebuild the rendition too — otherwise the book would load and no
    // rendition would ever be created for it, leaving the reader on
    // "Opening book…" forever with nothing failing anywhere. (Effects run in
    // declaration order within a commit, so the loader above has already set
    // the ref synchronously by the time this body runs.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, settings.mode, fileUrl]);

  // A later authoritative position (e.g. after a reconnect reconciles state)
  // arrives with a new `revision` — jump to it once, not on every render.
  useEffect(() => {
    if (!ready || !initialPosition || !renditionRef.current) return;
    if (appliedRevisionRef.current === initialPosition.revision) return;
    appliedRevisionRef.current = initialPosition.revision;
    restoreDisplay(renditionRef.current, (initialPosition.location as EpubLocation).cfi);
  }, [ready, initialPosition]);

  useEffect(() => {
    if (!remoteUpdate || !renditionRef.current) return;
    if (appliedRemoteRevisionRef.current === remoteUpdate.revision) return;
    appliedRemoteRevisionRef.current = remoteUpdate.revision;
    restoreDisplay(renditionRef.current, (remoteUpdate.location as EpubLocation).cfi);
  }, [remoteUpdate]);

  // Keep the reading position live while scrolling WITHIN a chapter. Only
  // epub.js's 'continuous' manager watched the scroller; the default one
  // reports a location when a section is displayed and then never again,
  // so without this the percentage would sit frozen until the next chapter
  // boundary — and, worse, the position synced to other devices would only
  // ever move a whole chapter at a time, losing your place within it.
  useEffect(() => {
    if (!ready || settings.mode === 'paginated') return;
    const el = containerRef.current?.querySelector('.epub-container') as HTMLElement | null;
    const rendition = renditionRef.current;
    if (!el || !rendition) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = () => (rendition as unknown as { reportLocation: () => void }).reportLocation();
    const onScroll = () => {
      onActivity();
      if (timer) clearTimeout(timer);
      // Recompute once the scroll has properly settled, and in idle time —
      // the CFI lookup walks the rendered section, and doing it mid-scroll
      // is a dropped frame.
      timer = setTimeout(() => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(report, { timeout: 500 });
        else report();
      }, 300);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.mode]);

  useEffect(() => {
    if (!ready || !renditionRef.current) return;
    applyTheme(renditionRef.current, settings);
  }, [ready, settings.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !renditionRef.current) return;
    applyTypography(renditionRef.current, settings);
  }, [ready, settings.fontFamily, settings.fontSize, settings.lineHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Padding is applied to the container (see the JSX below), not inside the
  // book's iframe — but epub.js only ever re-measures on a *window* resize,
  // so the container changing size under it is invisible to it. Without this
  // the box narrows and the already-laid-out content just spills out of it.
  //
  // Debounced because `resize()` clears and re-renders the current views,
  // and the padding sliders commit continuously while being dragged (which
  // they must — see ReaderSettingsMenu — since a touch drag often ends in
  // `pointercancel` with no `pointerup` to commit on). Re-rendering a chapter
  // at every frame of a drag would make the whole reader stutter; settling
  // shortly after the thumb stops is what a reflow this heavy can afford.
  useEffect(() => {
    if (!ready || !renditionRef.current) return;
    const timer = setTimeout(() => {
      // No arguments, which is exactly what epub.js's own window-resize
      // handler does: the rendition was created with width/height '100%', so
      // an argument-less resize re-measures the container instead of pinning
      // it to a stale pixel size. Cast because the bundled .d.ts declares
      // both arguments as required even though the implementation defaults
      // them.
      (renditionRef.current as unknown as { resize: (w?: number, h?: number) => void } | null)?.resize();
    }, 160);
    return () => clearTimeout(timer);
  }, [ready, pad.top, pad.right, pad.bottom, pad.left]);

  useEffect(() => {
    // `ready` (not just renditionRef.current) matters here: a target set
    // before the rendition exists — e.g. a library-search jump landing on
    // a fresh page load, vs. a TOC click which can't happen until the book
    // is already open — must wait rather than being silently dropped.
    // renditionRef is a ref, so it alone wouldn't retrigger this effect
    // once `ready` flips; `ready` in the deps is what makes the retry happen.
    if (!ready || !outlineTarget || !renditionRef.current) return;
    // A TOC click IS a real user navigation — publish it (not suppressed),
    // and treat it as discrete so it syncs immediately rather than waiting
    // out the debounce.
    if (outlineTarget.href) {
      discreteRef.current = true;
      renditionRef.current.display(outlineTarget.href);
    }
    onOutlineTargetHandled();
  }, [ready, outlineTarget, onOutlineTargetHandled]);

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
            // No mix-blend-mode: blending the overlay forces the browser to
            // recomposite the whole chapter layer on every scroll frame.
            'fill-opacity': '0.35',
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
        {/* Inset rather than padding: this element is what epub.js attaches to
            and measures with getBoundingClientRect(), which reports the border
            box — padding here would not shrink the box it sees, so it would go
            on laying the book out at full width. */}
        <div
          ref={containerRef}
          className={`${styles.container} ${settings.mode === 'continuous' ? styles.containerScrolled : ''}`}
          style={{ top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }}
        />
        {!ready && <div className={styles.centered}>Opening book…</div>}
        <div ref={pullHintRef} className={styles.pullHint} aria-hidden="true" />
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
        {selection && (
          <div ref={popupRef}>
            <HighlightPopup x={selection.x} y={selection.y} onPick={confirmHighlight} />
          </div>
        )}
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
