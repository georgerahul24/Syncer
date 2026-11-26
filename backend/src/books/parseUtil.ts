import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

// Pure helpers shared by the EPUB/PDF metadata and text-extraction modules.

export const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Resolves an href inside an EPUB. Entry paths use forward slashes regardless of host OS. */
export function resolveRelative(baseDir: string, href: string): string {
  const clean = href.split('#')[0];
  const joined = baseDir ? `${baseDir}/${clean}` : clean;
  return path.posix.normalize(joined).replace(/^(\.\.\/)+/, '');
}

/**
 * Opens a PDF with the same PDF.js build the frontend renders with (legacy
 * Node build, no DOM/worker), runs `fn` on it, and always frees it.
 */
type PdfDocument = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument>['promise']>;

export async function withPdfDocument<T>(filePath: string, fn: (doc: PdfDocument) => Promise<T>): Promise<T> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  try {
    return await fn(doc);
  } finally {
    await doc.destroy();
  }
}
