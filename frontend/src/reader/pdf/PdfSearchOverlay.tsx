import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation, PdfAnnotationLocation } from '../../types';
import SearchOverlay, { matchingAnnotations } from '../SearchOverlay';
import { searchPage, type PdfSearchMatch } from './search';

export type PdfSearchResult =
  | ({ kind: 'text' } & PdfSearchMatch)
  | { kind: 'annotation'; page: number; excerpt: string; annotationId: string };

/** Searches page by page (see search.ts for the matching), holding one page's text at a time. */
async function* searchPages(doc: PDFDocumentProxy, numPages: number, query: string) {
  for (let page = 1; page <= numPages; page++) {
    try {
      const matches = await searchPage(doc, page, query);
      if (matches.length) yield matches.map((m): PdfSearchResult => ({ kind: 'text', ...m }));
    } catch {
      // one unreadable page shouldn't abort the whole search
    }
  }
}

export default function PdfSearchOverlay({
  doc,
  numPages,
  annotations,
  open,
  onClose,
  onJump,
}: {
  doc: PDFDocumentProxy | null;
  numPages: number;
  annotations: Annotation[];
  open: boolean;
  onClose: () => void;
  onJump: (match: PdfSearchResult) => void;
}) {
  return (
    <SearchOverlay<PdfSearchResult>
      open={open}
      onClose={onClose}
      placeholder="Search text and notes…"
      source={doc}
      annotationMatches={(q) =>
        matchingAnnotations(annotations, 'pdf', q).map(({ annotation, excerpt }) => ({
          kind: 'annotation' as const,
          page: (annotation.location as PdfAnnotationLocation).page,
          excerpt,
          annotationId: annotation.id,
        }))
      }
      searchText={(q) => searchPages(doc!, numPages, q)}
      label={(r) => `${r.kind === 'annotation' ? '✎ ' : ''}Page ${r.page} — ${r.excerpt}`}
      onJump={onJump}
    />
  );
}
