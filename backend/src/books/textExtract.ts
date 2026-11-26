import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { resolveRelative, toArray, withPdfDocument, xmlParser } from './parseUtil.js';

export interface ExtractedTextChunk {
  page: number; // 1-based PDF page, or 1-based spine position for EPUB; always 1 for txt
  locationType: 'pdf-page' | 'epub-chapter' | 'txt';
  location: { page: number } | { href: string } | Record<string, never>;
  text: string;
}

/**
 * A .txt book is indexed as a single chunk (unlike PDF/EPUB, it has no
 * natural page/chapter boundaries) — a library-search hit can open the
 * book but can't jump to the exact match position within it, same
 * trade-off as an EPUB match only jumping to its chapter, not a precise
 * CFI (see search/README.md).
 */
export function extractTxtText(filePath: string): ExtractedTextChunk[] {
  const text = fs.readFileSync(filePath, 'utf-8').trim();
  return text ? [{ page: 1, locationType: 'txt', location: {}, text }] : [];
}

/** Per-page plain text, using the same PDF.js Node build as pdfMetadata.ts. */
export async function extractPdfText(filePath: string): Promise<ExtractedTextChunk[]> {
  return withPdfDocument(filePath, async (doc) => {
    const chunks: ExtractedTextChunk[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string }>)
        .map((item) => item.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) chunks.push({ page: i, locationType: 'pdf-page', location: { page: i }, text });
    }
    return chunks;
  });
}

// The EPUB spine/opf walk below stays separate from epubMetadata.ts's on
// purpose: that one is tested against real-world EPUBs for the
// higher-stakes upload-validation path. Only the pure helpers are shared.

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Per-chapter (spine item) plain text, keyed by the chapter's own href for jump targets. */
export function extractEpubText(filePath: string): ExtractedTextChunk[] {
  try {
    const zip = new AdmZip(filePath);
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) return [];
    const container = xmlParser.parse(containerEntry.getData().toString('utf-8'));
    const opfPath: string | undefined = toArray(container?.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
    if (!opfPath) return [];
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return [];
    const opf = xmlParser.parse(opfEntry.getData().toString('utf-8'));
    const pkg = opf?.package ?? {};
    const manifestItems = toArray(pkg.manifest?.item);
    const byId = new Map(manifestItems.map((item: any) => [item['@_id'], item]));
    const spineRefs = toArray(pkg.spine?.itemref);
    const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

    const chunks: ExtractedTextChunk[] = [];
    let position = 0;
    for (const ref of spineRefs) {
      const item = byId.get(ref?.['@_idref']);
      const href = item?.['@_href'];
      if (!href) continue;
      const entry = zip.getEntry(resolveRelative(opfDir, href));
      if (!entry) continue;
      const text = htmlToText(entry.getData().toString('utf-8'));
      position += 1;
      if (text) chunks.push({ page: position, locationType: 'epub-chapter', location: { href }, text });
    }
    return chunks;
  } catch {
    return []; // indexing is a best-effort add-on; a malformed EPUB shouldn't block anything
  }
}
