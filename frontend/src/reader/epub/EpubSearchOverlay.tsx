import type Book from 'epubjs/types/book';
import type { Annotation, EpubAnnotationLocation } from '../../types';
import SearchOverlay, { matchingAnnotations } from '../SearchOverlay';

interface SearchMatch {
  cfi: string;
  excerpt: string;
  isAnnotation?: boolean;
}

type SpineSection = { load: (r: Function) => Promise<Document>; unload: () => void; find: (q: string) => SearchMatch[] };

/**
 * Searches chapter by chapter, loading each section's DOM only long enough
 * to run epub.js's own text search (`Section.find`) and unloading it right
 * after, so a book with hundreds of chapters never holds more than one
 * extra chapter in memory.
 */
async function* searchChapters(book: Book, query: string) {
  const spineItems = (book.spine as unknown as { spineItems: SpineSection[] }).spineItems;
  for (const section of spineItems) {
    try {
      // Section.load() is asynchronous (it fetches + parses the chapter's
      // XML) even though its type signature suggests otherwise. Awaiting it
      // is required or section.find() runs before section.document exists
      // and silently finds nothing.
      await section.load(book.load.bind(book));
      const matches = section.find(query);
      section.unload();
      if (matches.length) yield matches;
    } catch {
      // an individual chapter failing to parse shouldn't abort the whole search
    }
  }
}

export default function EpubSearchOverlay({
  book,
  annotations,
  open,
  onClose,
  onJump,
}: {
  book: Book | null;
  annotations: Annotation[];
  open: boolean;
  onClose: () => void;
  onJump: (cfi: string) => void;
}) {
  return (
    <SearchOverlay<SearchMatch>
      open={open}
      onClose={onClose}
      placeholder="Search in book…"
      source={book}
      annotationMatches={(q) =>
        matchingAnnotations(annotations, 'epub', q).map(({ annotation, excerpt }) => ({
          cfi: (annotation.location as EpubAnnotationLocation).cfiRange,
          excerpt,
          isAnnotation: true,
        }))
      }
      searchText={(q) => searchChapters(book!, q)}
      label={(r) => `${r.isAnnotation ? '✎ ' : ''}${r.excerpt}`}
      onJump={(r) => onJump(r.cfi)}
    />
  );
}
