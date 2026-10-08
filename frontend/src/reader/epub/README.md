# EPUB reader

Built on [epub.js](https://github.com/futurepress/epub.js) 0.3.x. This
directory:

- `EpubReader.tsx` — the component implementing `ReaderComponentProps`
  (`../types.ts`). Owns the `Book`/`Rendition` lifecycle, position sync,
  highlight rendering, and text-selection → highlight creation.
- `themes.ts` — reading-content theme palettes (Light/Sepia/Dark) and
  appearance (font/size/line-height/margin/reading-width) application.
- `toc.ts` — converts epub.js's `NavItem[]` into this app's `TocItem[]`.
- `HighlightPopup.tsx` — the small color-swatch popup shown after a text
  selection.
- `EpubSearchOverlay.tsx` — self-contained in-book search (own UI + logic).

## Position model

EPUB has no stable page number — the durable location is a CFI (Canonical
Fragment Identifier), taken from `rendition.location`'s `start.cfi` via the
`relocated` event. `EpubLocation` (`../../types.ts`) is `{ cfi, chapterHref,
scrollOffset: 0 }` — `scrollOffset` is unused for EPUB today (CFI already
encodes sub-chapter position) but kept for shape-parity with `PdfLocation`.

**Progress (0..1)**: `book.locations.generate(1600)` is kicked off in the
background right after the book opens (never awaited before first paint —
walking the whole book's text can be slow for a large EPUB). Once it
resolves, `book.locations.percentageFromCfi(cfi)` gives an accurate
percentage. Until then, `relocated`'s own `location.start.percentage`
(a coarse per-section fraction epub.js computes for free) is used as a
fallback — see the `relocated` handler. Both are monotonically
non-decreasing as the reader progresses forward, which is what
`useReaderSync`'s offline-reconciliation heuristic depends on (see
`reader/sync/README.md`).

## Loop prevention — the trickiest part of this reader

Read the comment block at the top of `EpubReader.tsx` first; this is the
short version.

epub.js's `Rendition` emits **the same** `relocated` event whether the user
actually navigated (scrolling, `next()`/`prev()`, clicking an in-book link)
or whether *we* called `rendition.display(cfi)` ourselves to apply
`initialPosition`, a `remoteUpdate` from another session, a TOC/annotation
jump, or a mode-switch redisplay. If `relocated` always published, applying
a `remoteUpdate` would immediately re-publish it as if the user had just
navigated there — the exact A→server→B→server→A loop
`backend/src/sync/README.md` warns about.

The fix is `programmaticDisplay()`, a thin wrapper around
`rendition.display()`:

```ts
function programmaticDisplay(rendition, target) {
  suppressRelocateRef.current = true;
  suppressTimerRef.current = setTimeout(() => (suppressRelocateRef.current = false), 800);
  return rendition.display(target);
}
```

Every call site that displays a location for a reason **other than direct
user navigation** goes through this wrapper instead of calling
`rendition.display()` directly:

- the initial mount display (opening at `initialPosition` or the book start)
- the `initialPosition`-revision-changed effect (post-reconnect reconcile)
- the `remoteUpdate` effect (another session's change)
- the mode-switch effect's redisplay (re-rendering the *same* cfi under a
  new `flow` — not a navigation at all)
- `focusAnnotationId` (reviewing an annotation from the panel is a "peek",
  not "I'm reading from here now" — a deliberate product choice, see the
  comment at that effect; the PDF reader may make a different call here,
  which is fine, it's a per-format UX decision, not a shared contract)

The `relocated` handler checks the flag first and, if set, clears it and
returns **before** calling `onLocalPositionChange` — it never publishes.

Everything else — the paginated next/prev buttons, arrow-key and swipe page
turns, a TOC click, a search-result jump — calls `rendition.display()` (or
`.next()`/`.prev()`) directly, so it's never suppressed and always
publishes. Those also set `discreteRef.current = true` first, so the
`relocated` handler passes `{ immediate: true }` to `onLocalPositionChange`
or immediately syncs — matching section 19's requirement that discrete
navigation events aren't held back by the ~800ms debounce continuous
scrolling uses.

**Why a timer as well as clearing on `relocated`**: displaying a CFI that's
already the current location doesn't always fire `relocated` at all. Without
the timer fallback, a suppression flag set right before such a no-op
`display()` call would stay `true` forever and silently swallow the *next*
genuine user navigation's publish. The 800ms timer bounds that risk to a
brief window without ever needing exact CFI-equality comparison (which is
unreliable — a requested CFI and the CFI epub.js reports back after
displaying it aren't always byte-identical).

## Highlights

Rendering: `rendition.annotations.highlight(cfiRange, {}, undefined,
'epub-highlight', { fill, 'fill-opacity': '0.4', 'mix-blend-mode':
'multiply' })`. `fill` uses `var(--color-highlight-*)` from
`styles/variables.css` directly (see `HighlightPopup.tsx`'s `COLOR_VAR`) —
this works even though the highlight is visually drawn "over" chapter
content, because epub.js's highlight overlay (via the `marks-pane` package)
is actually an SVG appended to the *outer* app document (positioned with
`getBoundingClientRect()` math over the iframe), not injected inside the
sandboxed chapter iframe — so it participates in the same CSS custom
property cascade as the rest of the app. Don't assume overlay elements are
inside the iframe; they aren't.

Creation: `rendition.on('selected', (cfiRange, contents) => ...)` gives the
CFI range; the selected text and a screen position for the popup come from
`contents.window.getSelection()` (synchronous — no need for the async
`book.getRange()`).

The annotations-sync effect diffs by a `${cfiRange}:${color}` key against
the last-rendered set, so it removes annotations that were deleted/recolored
and adds new ones without a full clear-and-rebuild each render.

## Security

`allowScriptedContent` is left off (the default) when creating the
rendition — uploaded EPUBs are untrusted archives (section 31) and this is
what keeps embedded `<script>` tags in chapter content from executing.
Don't turn this on.

## Known simplifications

- Two-page spread on wide screens: not implemented. Single-page paginated
  view only. Would be a `spread: 'auto'` rendition option plus width-based
  layout tweaks if wanted later.
- The search overlay's `MAX_MATCHES` cap (300) is a deliberate bound for
  pathological cases (a single repeated word in a very long book); it's
  logged nowhere visible today beyond the `300+` suffix in the result count
  — acceptable for how rarely it'd actually trigger, but worth knowing if
  someone reports "search stopped early."
