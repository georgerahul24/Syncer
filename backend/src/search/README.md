# Library-wide search

Searches across every book a user owns — not just the currently open
book (that's `frontend/src/reader/pdf/PdfSearchOverlay.tsx` /
`EpubSearchOverlay.tsx`, which search a single already-loaded document
client-side and are unrelated to this subsystem).

## Pieces

- **`backend/src/books/textExtract.ts`** — pulls plain text out of a PDF
  (per page, via the same PDF.js Node build `pdfMetadata.ts` uses) or an
  EPUB (per spine item/chapter, via a small self-contained OPF/spine
  parser — deliberately *not* sharing code with `epubMetadata.ts`, to
  avoid risking a refactor of that already-tested upload-validation path
  for a much lower-stakes feature).
- **`backend/src/search/textIndex.ts`** — writes/deletes rows in the
  `book_text_fts` FTS5 virtual table (see `database/schema.sql`), plus
  `backfillMissingTextIndexes()`, run once at startup (`index.ts`) for
  any book that predates this feature or whose indexing failed before.
- **`backend/src/search/routes.ts`** — `GET /api/search?q=...`, scoped to
  `req.userId` throughout (never trusts a client-supplied book id). Merges
  three sources into one flat, capped result list:
  1. Document text (FTS5 `MATCH`, ranked by `rank`/bm25, snippet via
     FTS5's own `snippet()`).
  2. Annotations (`note`/`selectedText`, plain `LIKE` — the annotations
     table isn't FTS5-indexed; a personal library's annotation count
     doesn't need it).
  3. Book title/author matches.
- **`frontend/src/pages/LibraryPage.tsx`** — the search box in the
  library header; results link to `/book/:id?jumpPage=N` (PDF) or
  `?jumpHref=...` (EPUB), which `ReaderPage.tsx` reads once on mount and
  turns into an `outlineTarget` — the same mechanism the table-of-contents
  panel already uses to jump to a page/chapter.

## Why FTS5 and not something bigger

Confirmed available in the installed `better-sqlite3` build before
committing to this design (a throwaway in-memory `CREATE VIRTUAL TABLE
... USING fts5(...)` test). No separate search service, no reindex job
queue — a self-hosted single-process app doesn't need either.

## Known limitation

An EPUB text match can only jump to the start of its chapter, not a
precise in-chapter position — server-side extraction has no way to
produce an epub.js CFI (those are computed client-side against a loaded
rendition). The in-book `EpubSearchOverlay` gives precise jumps because
it searches the already-open book directly; this subsystem trades that
precision for being able to search books that aren't open at all.

## When a book's text won't show up in results

Indexing happens synchronously right after upload (`createBook.ts`), so
in practice every new book indexes immediately. If it's missing anyway:

- It failed to index — check the server log for `[search] failed to
  index book ...`. Indexing failure never blocks the upload itself.
- It was uploaded before this feature shipped and the server hasn't
  been restarted since (the startup backfill in `index.ts` picks up any
  book with no `book_text_fts` rows — restart the server to trigger it).
