import type { Annotation, Book, NewAnnotationInput, ReaderSettings, ReadingPosition, TocItem } from '../types';
import type { RemoteUpdate } from './sync/useReaderSync';

/**
 * Contract implemented by both reader/pdf/PdfReader.tsx and
 * reader/epub/EpubReader.tsx. ReaderPage (pages/ReaderPage.tsx) owns all
 * shared chrome (top bar, annotation panel, settings menu, TOC panel) and
 * mounts exactly one of these depending on `book.format` — the two reader
 * implementations never need to know about each other.
 */
export interface ReaderComponentProps {
  book: Book;
  settings: ReaderSettings;
  /** All of this book's annotations, for rendering highlights inline. */
  annotations: Annotation[];
  /** Authoritative starting position (reconciled by useReaderSync) or null for a never-opened book. */
  initialPosition: ReadingPosition | null;
  /** A position that arrived from another session. Apply it as a jump — do NOT feed it back into onLocalPositionChange (see reader/sync/README.md). */
  remoteUpdate: RemoteUpdate | null;
  /** Call on every real user-driven navigation (scroll settle, page turn, TOC/search jump). This is useReaderSync's publishLocalPosition. */
  onLocalPositionChange: (locationType: string, location: unknown, progress: number, opts?: { immediate?: boolean }) => void;
  /** User selected text and chose to highlight/annotate it. */
  onCreateAnnotation: (input: NewAnnotationInput) => void;
  /** Report the parsed table of contents once available; ReaderPage renders the TOC panel itself. */
  onOutlineLoaded: (toc: TocItem[]) => void;
  /** ReaderPage calls this (via the TOC panel) to ask the reader to jump to a chapter/page. */
  outlineTarget: TocItem | null;
  onOutlineTargetHandled: () => void;
  /** Set by the annotation panel when the user clicks an annotation; reader should scroll to and briefly emphasize it, then clear via onFocusHandled. */
  focusAnnotationId: string | null;
  onFocusHandled: () => void;
  /** Controlled by the shared top bar's search button. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Whether chrome (incl. this reader's own overlays) should currently be visible; call onActivity() on any pointer/keyboard interaction to keep it visible. */
  controlsVisible: boolean;
  onActivity: () => void;
  /** Report a user-facing load/render failure (corrupted file, unsupported format, etc). ReaderPage shows it as a banner — never let the raw error/exception reach the user. */
  onError: (message: string) => void;
}
