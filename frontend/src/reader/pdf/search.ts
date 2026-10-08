import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NormalizedRect } from './PdfPage';

export interface PdfSearchMatch {
  page: number;
  rects: NormalizedRect[];
  excerpt: string;
}

/**
 * Approximate but cheap: text items from page.getTextContent() are
 * concatenated with no separator and searched as plain text; a match is
 * mapped back to whichever item(s) overlap its character range, and each
 * item's own PDF-space box (transform[4]/[5] + width/height) is converted
 * to a normalized [0,1] rect via the page's own viewport. Good enough for
 * a visible highlight — not pixel-perfect sub-word boundaries.
 */
export async function searchPage(doc: PDFDocumentProxy, pageNumber: number, query: string): Promise<PdfSearchMatch[]> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; transform: number[]; width: number; height: number }>;

  let fullText = '';
  const spans: Array<{ start: number; end: number; item: (typeof items)[number] }> = [];
  for (const item of items) {
    const start = fullText.length;
    fullText += item.str;
    spans.push({ start, end: fullText.length, item });
  }

  const haystack = fullText.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return [];

  const matches: PdfSearchMatch[] = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    const matchEnd = idx + needle.length;
    const overlapping = spans.filter((s) => s.start < matchEnd && s.end > idx);
    const rects: NormalizedRect[] = overlapping.map(({ item }) => {
      const x = item.transform[4];
      const y = item.transform[5];
      const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([x, y, x + item.width, y + item.height]);
      const left = Math.min(vx1, vx2);
      const top = Math.min(vy1, vy2);
      return {
        x: left / viewport.width,
        y: top / viewport.height,
        width: Math.abs(vx2 - vx1) / viewport.width,
        height: Math.abs(vy2 - vy1) / viewport.height,
      };
    });
    if (rects.length > 0) {
      const excerptStart = Math.max(0, idx - 30);
      matches.push({ page: pageNumber, rects, excerpt: fullText.slice(excerptStart, matchEnd + 30) });
    }
    from = matchEnd;
  }
  return matches;
}
