# PDF reader

Built on `pdfjs-dist` (the Node-side metadata extractor in
`backend/src/books/pdfMetadata.ts` uses the same library, but this is a
fully separate, browser-side usage — no code is shared between them).

- `pdfjsSetup.ts` — configures the PDF.js worker for Vite. Always import
  `pdfjs` from here, never from `pdfjs-dist` directly.
- `usePdfDocument.ts` — loads the document (`pdfjs.getDocument`), resolves
  the outline into `TocItem[]`, reports load failures as a friendly string.
- `PdfPage.tsx` — renders ONE page: canvas + text layer + highlight/search
  overlays, or a same-sized placeholder `<div>` when not "active".
- `search.ts` — approximate text search + rect mapping for a single page.
- `PdfSearchOverlay.tsx` — the in-book search UI, searching page by page.
- `HighlightPopup.tsx` — the small color-swatch popup shown after a
  selection.
- `PdfReader.tsx` — orchestrates all of the above and implements
  `ReaderComponentProps` (`../types.ts`).

## Virtualization (the performance-critical part)

`PdfReader` always mounts one `<PdfPage>` per page number (so continuous
mode has a stable, correctly-sized scroll track and doesn't jump around as
you scroll — "stable page containers"), but each `PdfPage` only renders its
real `<canvas>` + text layer when it's `active`. A single
`IntersectionObserver` (root = the scroll container, `rootMargin:
"1200px 0px"`) decides which pages are active — anything within ~1.5
screens of the viewport gets rendered; everything else is just an empty,
correctly-sized `<div>`. That's what keeps a 1000+ page book usable: at any
moment only a handful of canvases exist, and pages scrolled far away are
unmounted back down to a placeholder (their render task is cancelled via
`renderTask.cancel()`/`textLayer.cancel()` in `PdfPage`'s effect cleanup,
so an in-flight render for a page you've already scrolled past doesn't
keep running).

Page size: `PdfReader` fetches page 1's viewport once (at scale 1) and uses
it as the estimate for every page's placeholder — real-world PDFs are
overwhelmingly uniform-page-size, and this avoids calling `getPage()` for
all N pages up front just to measure them. If an individual page's actual
rendered size differs from that estimate, `PdfPage` corrects its own size
after rendering (see its `onMeasured`/`size` state) — only that one page's
placeholder was ever wrong, and only briefly.

Paginated mode sidesteps all of this: only the current page is ever
mounted (`active` is always true, `registerNode` is a no-op), so there's
nothing to virtualize.

## Zoom / fit

`scale` is computed once (`useMemo`) from `settings.pdfZoom` (`'fit-width'
| 'fit-page' | number`), the container's measured size (`ResizeObserver` on
the outer wrapper), page 1's intrinsic size, and `settings.readingWidth` as
a cap on fit-width. `H_PADDING`/`V_PADDING` constants approximate
`PdfReader.module.css`'s `.scrollArea` padding — if that padding changes,
update these too (a small, deliberate coupling; re-measuring the actual
padding every layout pass wasn't worth it).

`settings.theme` only affects the chrome around the pages (`.wrap`'s
background) — the rendered page canvas is a raster of the original PDF and
can't be recolored. That's a real, expected limitation of PDF readers in
general, not a bug.

## Position sync — loop prevention

Same shape as `reader/epub/EpubReader.tsx`'s (read that file's README too
if you haven't): a `suppressRef`, set right before any programmatic page
jump (`goToPage(..., { suppress: true })`), tells the scroll-tracking
effect to swallow the next "current page changed" tick instead of calling
`onLocalPositionChange`. A timer bounds it in case the jump lands on the
page that was already current (which produces no observable change at
all, so nothing would otherwise clear the flag).

- `initialPosition` / `remoteUpdate` / `focusAnnotationId` → suppressed
  (the last one is a "peek at this annotation", not "I'm reading from here
  now" — matching the product decision already made in the EPUB reader).
- An outline click / search-result jump → NOT suppressed, and marked
  `discrete` so it publishes immediately rather than waiting out the
  ~800ms debounce continuous scrolling relies on.
- Ordinary scrolling → tracked via the same `IntersectionObserver`-driven
  "current page" computation, published through the default (debounced)
  path.

## Highlights

Stored as `{ page, rects, contextBefore, contextAfter }` where `rects` are
normalized to `[0,1]` against the text layer container's own bounding box
at the time of selection — not raw screen coordinates — so they stay
correct across zoom and window-resize (`PdfPage.handleMouseUp`).
Rendering denormalizes them back against whatever the page's current
rendered size happens to be.

## Search

`search.ts` concatenates each page's `getTextContent()` items with no
separator and does a plain substring search — cheap, but can occasionally
miss a match that spans a word-boundary gap real PDFs don't always encode
as their own whitespace item. A found match's character range is mapped
back to whichever text item(s) overlap it, and each item's PDF-space box
(`transform[4]/[5]` + `width`/`height`) is converted to a normalized rect
via `viewport.convertToViewportRectangle`. Only the currently-jumped-to
match is rendered as a highlight overlay (not every occurrence across the
whole document at once) — cheap, and matches what most PDF readers
actually show.

## Known simplifications

- Two-page spread on wide screens: not implemented (paginated mode is
  always single-page). Optional per the spec; skipped for time.
- Search match highlighting shows only the active result, not all matches
  simultaneously (see above).
- `contextBefore`/`contextAfter` on a highlight are derived from the text
  layer's own concatenated `textContent`, which has the same
  no-separator-between-items quirk as search — cosmetic only (they're not
  used to relocate the highlight, just stored for context).
