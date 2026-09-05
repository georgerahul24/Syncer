import { useEffect, useState } from 'react';
import { pdfjs } from './pdfjsSetup';
import type { TocItem } from '../../types';

export interface PdfDocState {
  doc: import('pdfjs-dist').PDFDocumentProxy | null;
  numPages: number;
  toc: TocItem[];
  error: string | null;
}

async function resolveOutline(doc: import('pdfjs-dist').PDFDocumentProxy): Promise<TocItem[]> {
  const raw = await doc.getOutline().catch(() => null);
  if (!raw) return [];
  async function convert(items: any[]): Promise<TocItem[]> {
    const out: TocItem[] = [];
    for (const item of items) {
      let page: number | null = null;
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) page = (await doc.getPageIndex(dest[0])) + 1;
      } catch {
        page = null;
      }
      out.push({
        label: String(item.title ?? '').trim() || 'Untitled',
        page,
        items: item.items?.length ? await convert(item.items) : undefined,
      });
    }
    return out;
  }
  return convert(raw);
}

/** Loads a PDF document via the file's authenticated URL and tears it down on unmount/url change. */
export function usePdfDocument(url: string): PdfDocState {
  const [state, setState] = useState<PdfDocState>({ doc: null, numPages: 0, toc: [], error: null });

  useEffect(() => {
    let cancelled = false;
    let doc: import('pdfjs-dist').PDFDocumentProxy | null = null;
    setState({ doc: null, numPages: 0, toc: [], error: null });

    pdfjs
      .getDocument({ url, withCredentials: true, isEvalSupported: false })
      .promise.then(async (loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        doc = loaded;
        const toc = await resolveOutline(loaded);
        if (cancelled) return;
        setState({ doc: loaded, numPages: loaded.numPages, toc, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = /password/i.test(String(err?.name ?? '') + String(err?.message ?? ''))
          ? 'This PDF is password-protected and cannot be opened.'
          : 'This PDF could not be opened. It may be corrupted or unsupported.';
        setState({ doc: null, numPages: 0, toc: [], error: message });
      });

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [url]);

  return state;
}
