import type { Annotation, PdfAnnotationLocation, EpubAnnotationLocation, TocItem } from '../../types';

function flatten(items: TocItem[], out: TocItem[] = []): TocItem[] {
  for (const item of items) {
    out.push(item);
    if (item.items) flatten(item.items, out);
  }
  return out;
}

/**
 * Best-effort chapter label for grouping the annotation panel (section 25's
 * "Chapter 4" / "Chapter 7" grouping). For PDF this is exact (nearest
 * preceding outline entry by page). For EPUB it matches by chapter file,
 * ignoring any in-chapter fragment — good enough for a reasonably-chunked
 * EPUB without needing real CFI document-order comparison.
 */
export function resolveChapterLabel(annotation: Annotation, toc: TocItem[]): string {
  const flat = flatten(toc);
  if (annotation.locationType === 'pdf') {
    const page = (annotation.location as PdfAnnotationLocation).page;
    let best: TocItem | null = null;
    for (const item of flat) {
      if (item.page != null && item.page <= page && (best?.page ?? -1) <= item.page) best = item;
    }
    return best?.label ?? 'Untitled';
  }
  const href = (annotation.location as EpubAnnotationLocation).chapterHref;
  const base = href?.split('#')[0];
  const match = base ? flat.find((item) => item.href?.split('#')[0] === base) : undefined;
  return match?.label ?? 'Untitled';
}
