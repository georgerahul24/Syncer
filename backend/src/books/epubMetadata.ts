import AdmZip from 'adm-zip';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export interface EpubMetadata {
  title: string | null;
  author: string | null;
  identifier: string | null;
  cover: { data: Buffer; ext: string } | null;
}

const MAX_XML_ENTRY_BYTES = 5 * 1024 * 1024; // guard against pathological/zip-bomb metadata files
const MAX_COVER_BYTES = 20 * 1024 * 1024;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === 'string') return node.trim() || null;
  if (typeof node === 'object' && '#text' in (node as any)) {
    const t = (node as any)['#text'];
    return typeof t === 'string' ? t.trim() || null : null;
  }
  return null;
}

function firstText(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = textOf(n);
      if (t) return t;
    }
    return null;
  }
  return textOf(node);
}

// EPUB entry paths use forward slashes regardless of host OS.
function resolveRelative(baseDir: string, href: string): string {
  const clean = href.split('#')[0];
  const joined = baseDir ? `${baseDir}/${clean}` : clean;
  return path.posix.normalize(joined).replace(/^(\.\.\/)+/, '');
}

function readEntry(zip: AdmZip, entryPath: string): Buffer | null {
  const entry = zip.getEntry(entryPath);
  if (!entry || entry.isDirectory) return null;
  return entry.getData();
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * Extracts just enough metadata for the library view: title, author,
 * identifier, and a cover image. The table of contents is intentionally
 * NOT parsed here — epub.js parses navigation itself client-side when the
 * reader opens the book, so duplicating it server-side would just be a
 * second, possibly-diverging parser (see pdfMetadata.ts for the same call
 * on the PDF side).
 *
 * The EPUB zip is only ever read into memory buffers keyed by our own
 * lookup logic; we never write a zip-entry-provided name to disk, so
 * zip-slip is not applicable here even though the archive is untrusted.
 */
export function extractEpubMetadata(filePath: string): EpubMetadata {
  const zip = new AdmZip(filePath);

  const containerXml = readEntry(zip, 'META-INF/container.xml');
  if (!containerXml) throw new Error('Not a valid EPUB: missing META-INF/container.xml');
  const container = parser.parse(containerXml.toString('utf-8'));
  const rootfile = toArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath: string | undefined = rootfile?.['@_full-path'];
  if (!opfPath) throw new Error('Not a valid EPUB: no OPF rootfile declared');

  const opfBuf = readEntry(zip, opfPath);
  if (!opfBuf || opfBuf.length > MAX_XML_ENTRY_BYTES) throw new Error('Not a valid EPUB: unreadable package document');
  const opf = parser.parse(opfBuf.toString('utf-8'));
  const pkg = opf?.package ?? {};
  const metadata = pkg.metadata ?? {};
  const manifestItems = toArray(pkg.manifest?.item);
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  const title = firstText(metadata.title);
  const creators = toArray(metadata.creator).map(textOf).filter((v): v is string => !!v);
  const author = creators.length ? creators.slice(0, 3).join(', ') : null;
  const identifier = firstText(metadata.identifier);

  let coverItem = manifestItems.find((item) => {
    const props = String(item?.['@_properties'] ?? '').split(/\s+/);
    return props.includes('cover-image');
  });
  if (!coverItem) {
    const coverMeta = toArray(metadata.meta).find((m: any) => m?.['@_name'] === 'cover');
    const coverId = coverMeta?.['@_content'];
    if (coverId) coverItem = manifestItems.find((item) => item?.['@_id'] === coverId);
  }

  let cover: EpubMetadata['cover'] = null;
  if (coverItem?.['@_href']) {
    const coverPath = resolveRelative(opfDir, coverItem['@_href']);
    const data = readEntry(zip, coverPath);
    const mime = String(coverItem['@_media-type'] ?? '');
    if (data && data.length > 0 && data.length <= MAX_COVER_BYTES && EXT_BY_MIME[mime]) {
      cover = { data, ext: EXT_BY_MIME[mime] };
    }
  }

  return { title, author, identifier, cover };
}
