# Reader subsystem

`pages/ReaderPage.tsx` is the entry point: it owns all shared chrome (top
bar, TOC panel, annotation panel, settings menu, the always-visible sync
status dot) and mounts exactly one format-specific reader — `pdf/PdfReader.tsx`
or `epub/EpubReader.tsx` — depending on `book.format`. The two reader
implementations never know about each other; they both implement the same
`ReaderComponentProps` contract defined in `types.ts`. Read that file
first if you're trying to understand how a prop flows from ReaderPage into
either reader.

## Where things live

```text
reader/
  types.ts                  the ReaderComponentProps contract both readers implement
  useControlsVisibility.ts  shared "fade out chrome after inactivity" behavior (section 33)
  ReaderTopBar.tsx           back button, title, sync status, TOC/search/annotations/settings buttons
  ReaderSettingsMenu.tsx      theme/font/layout popover, bound to useReaderSettings
  TocPanel.tsx                table of contents sidebar (data comes from the mounted reader via onOutlineLoaded)
  sync/                       cross-device position sync — see sync/README.md, read it before touching anything sync-related
  annotations/                 highlight/note data + the shared annotation panel — see annotations/README.md
  pdf/                          PDF.js-based reader — see pdf/README.md
  epub/                          epub.js-based reader — see epub/README.md
```

## Why the split is where it is

Anything that's genuinely format-specific (rendering, virtualization,
search implementation, how a highlight gets created from a selection)
lives inside `pdf/` or `epub/`. Anything that's the same regardless of
format (the chrome, the annotation list UI, the settings persistence, the
sync protocol) lives one level up and is passed in as props/callbacks. If
you find yourself wanting to `if (book.format === 'pdf')` inside a shared
component, that's usually a sign the behavior belongs inside one of the
two reader implementations instead, reached via a prop.

## The one invariant that spans every file in here

A position that arrived from the server (`remoteUpdate`, `initialPosition`)
must only ever be **applied** — never fed back into
`onLocalPositionChange`. This is what prevents a sync ping-pong loop
between two open sessions of the same book (see `sync/README.md` and
`backend/src/sync/README.md`). Both `PdfReader` and `EpubReader` have to
uphold this independently since they each drive their own underlying
rendering library's navigation differently — check their own READMEs for
how each one specifically avoids re-publishing a programmatic jump.
