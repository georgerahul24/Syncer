# Annotations

`useAnnotations.ts` loads a book's annotations and exposes optimistic
`create`/`update`/`remove`. `AnnotationPanel.tsx` is the shared sidebar UI
(mounted once by `ReaderPage`, format-agnostic); `NoteEditor.tsx` is a
small debounced-autosave textarea (section 24: no request per keystroke);
`chapterLabel.ts` resolves a "which chapter is this annotation in" label
for the panel's grouping, using whatever `TocItem[]` the active reader
reported via `onOutlineLoaded`.

## Data model

There's no separate "note" annotation type — `type` is always
`'highlight'`. A note is just an optional `note` field a highlight can
carry (see `types/index.ts`'s `Annotation`). This matches the product
spec's actual UI: you highlight text, and *optionally* attach a note to
that highlight; there's no way to create a floating note unattached to any
text.

`location` is opaque here and typed as `PdfAnnotationLocation |
EpubAnnotationLocation` — this module never reads its contents (no
page/CFI logic lives here). That's deliberate: navigating *to* an
annotation is the mounted reader's job (`focusAnnotationId` /
`onFocusHandled` in `ReaderComponentProps`), not this module's.

## Optimistic updates + offline queue

Every mutation updates local state immediately (so the UI never waits on
a round-trip) and fires the real request in the background. If that
request fails with a network error specifically (not a server rejection —
see `services/offlineQueue.ts`'s `isNetworkError`), it's held in memory
and retried automatically once the browser reports it's back online. A
server *rejection* (4xx) is not retried — the optimistic local state is
rolled back instead (for `create`) or just left as-is (for `update`
/`remove`, which are idempotent enough that a failed retry isn't worth
reverting visually).
