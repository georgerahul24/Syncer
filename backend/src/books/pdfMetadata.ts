import fs from 'node:fs';

export interface PdfMetadata {
  title: string | null;
  author: string | null;
  pageCount: number;
}

/**
 * Extracts lightweight metadata using the same PDF.js build the frontend
 * renders with (legacy Node build, no DOM/worker). We never hand-roll PDF
 * parsing. Deliberately does NOT extract the outline: the reader already
 * loads the full document client-side and can read pdf.getOutline()
 * directly from it, so duplicating that here would just be two parsers
 * that can disagree.
 */
export async function extractPdfMetadata(filePath: string): Promise<PdfMetadata> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown>;
    const title = typeof info?.Title === 'string' && info.Title.trim() ? info.Title.trim() : null;
    const author = typeof info?.Author === 'string' && info.Author.trim() ? info.Author.trim() : null;
    return { title, author, pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
