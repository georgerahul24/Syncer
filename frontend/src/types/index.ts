export type BookFormat = 'pdf' | 'epub';

export interface User {
  id: string;
  email: string;
  syncEnabled: boolean;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  bookCount: number;
}

export interface Tag {
  id: string;
  name: string;
  bookCount?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  pageCount: number | null;
  identifier: string | null;
  coverUrl: string | null;
  syncEnabled: boolean;
  folderId: string | null;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
  progress: { progress: number; updatedAt: string } | null;
}

// Format-specific location payloads. Opaque to everything except the
// reader that produced them and, for PDF, the annotation overlay.
export interface PdfLocation {
  page: number;
  scrollOffset: number;
}

export interface EpubLocation {
  cfi: string;
  chapterHref: string | null;
  scrollOffset: number;
}

export interface ReadingPosition {
  locationType: 'pdf-page' | 'epub-cfi';
  location: PdfLocation | EpubLocation;
  progress: number; // 0..1
  revision: number;
  updatedAt: string;
}

export type AnnotationType = 'highlight' | 'note';
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface PdfAnnotationLocation {
  page: number;
  // Rects are normalized to [0,1] against the page's own width/height, so
  // they stay correct across zoom levels and window resizes.
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  contextBefore?: string;
  contextAfter?: string;
}

export interface EpubAnnotationLocation {
  cfiRange: string;
  chapterHref: string | null;
}

export interface Annotation {
  id: string;
  bookId: string;
  type: AnnotationType;
  color: AnnotationColor;
  locationType: 'pdf' | 'epub';
  location: PdfAnnotationLocation | EpubAnnotationLocation;
  selectedText: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAnnotationInput {
  type: AnnotationType;
  color: AnnotationColor;
  locationType: 'pdf' | 'epub';
  location: PdfAnnotationLocation | EpubAnnotationLocation;
  selectedText?: string;
  note?: string;
}

export interface TocItem {
  label: string;
  page?: number | null;
  href?: string;
  items?: TocItem[];
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';

export interface ReaderPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ReaderSettings {
  theme: ReaderTheme;
  fontFamily: string;
  fontSize: number; // px, epub only
  lineHeight: number; // unitless multiplier, epub only
  padding: ReaderPadding; // px per direction, both formats — user-controlled reading comfort spacing
  pdfZoom: number | 'fit-width' | 'fit-page';
  mode: 'continuous' | 'paginated';
}
