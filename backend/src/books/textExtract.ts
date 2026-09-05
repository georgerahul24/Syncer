import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export interface ExtractedTextChunk {
  page: number; // 1-based PDF page, or 1-based spine position for EPUB
  locationType: 'pdf-page' | 'epub-chapter';
  location: { page: number } | { href: string };
  text: string;
}

/** Per-page plain text, using the same PDF.js Node build as pdfMetadata.ts. */
export async function extractPdfText(filePath: string): Promise<ExtractedTextChunk[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
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
  } finally {
    await doc.destroy();
  }
}

// A small, self-contained EPUB spine/opf parser rather than reusing
// epubMetadata.ts's internals — that module's parsing is already tested
// against real-world EPUBs for the (much higher-stakes) upload-validation
// path, and duplicating ~20 lines here is cheaper than risking a shared
// refactor of that code.
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveRelative(baseDir: string, href: string): string {
  const clean = href.split('#')[0];
  const joined = baseDir ? `${baseDir}/${clean}` : clean;
  return path.posix.normalize(joined).replace(/^(\.\.\/)+/, '');
}

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
