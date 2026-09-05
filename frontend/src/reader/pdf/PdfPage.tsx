import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjs } from './pdfjsSetup';
import type { Annotation, PdfAnnotationLocation } from '../../types';
import styles from './PdfPage.module.css';

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingPdfSelection {
  page: number;
  rects: NormalizedRect[];
  text: string;
  contextBefore: string;
  contextAfter: string;
  x: number;
  y: number;
}

export interface SearchMatchOnPage {
  rects: NormalizedRect[];
  active: boolean;
}

export default function PdfPage({
  doc,
  pageNumber,
  scale,
  active,
  placeholderWidth,
  placeholderHeight,
  onMeasured,
  registerNode,
  highlights,
  focusedAnnotationId,
  searchMatches,
  onSelectionCreated,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  active: boolean;
  placeholderWidth: number;
  placeholderHeight: number;
  onMeasured: (page: number, width: number, height: number) => void;
  registerNode: (page: number, el: HTMLDivElement | null) => void;
  highlights: Annotation[];
  focusedAnnotationId: string | null;
  searchMatches: SearchMatchOnPage[];
  onSelectionCreated: (sel: PendingPdfSelection) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: placeholderWidth, height: placeholderHeight });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // Drives a short fade-in once the canvas actually has pixels, instead of
  // the canvas popping in abruptly the instant it mounts (mounting and
  // having rendered content are two different moments — see the render
  // effect below).
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    registerNode(pageNumber, rootRef.current);
    return () => registerNode(pageNumber, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  // Keep an inactive page's placeholder tracking the current estimate
  // (e.g. after a zoom change) — an active page doesn't need this since
  // the render effect below re-measures it directly whenever `scale`
  // changes, which supersedes the estimate anyway.
  useEffect(() => {
    if (!active) setSize({ width: placeholderWidth, height: placeholderHeight });
  }, [active, placeholderWidth, placeholderHeight]);

  useEffect(() => {
    if (!active) {
      setRendered(false);
      return;
    }
    let cancelled = false;
    let renderTask: ReturnType<import('pdfjs-dist').PDFPageProxy['render']> | null = null;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      if (cssWidth !== sizeRef.current.width || cssHeight !== sizeRef.current.height) {
        setSize({ width: cssWidth, height: cssHeight });
        onMeasured(pageNumber, cssWidth, cssHeight);
      }

      renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      try {
        await renderTask.promise;
      } catch {
        return; // cancelled — expected when this page scrolls out before finishing
      }
      if (cancelled) return;
      setRendered(true);
      if (!textLayerRef.current) return;

      textLayerRef.current.innerHTML = '';
      const textContent = await page.getTextContent();
      textLayer = new pdfjs.TextLayer({
        textContentSource: textContent as any,
        container: textLayerRef.current,
        viewport,
      });
      await textLayer.render().catch(() => {});
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      setRendered(false);
    };
  }, [doc, pageNumber, scale, active, onMeasured]);

  function handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const container = textLayerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;
    const text = selection.toString().trim();
    if (!text) return;

    const containerRect = container.getBoundingClientRect();
    const rects: NormalizedRect[] = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        x: (r.left - containerRect.left) / containerRect.width,
        y: (r.top - containerRect.top) / containerRect.height,
        width: r.width / containerRect.width,
        height: r.height / containerRect.height,
      }));
    if (rects.length === 0) return;

    const fullText = container.textContent ?? '';
    const idx = fullText.indexOf(text);
    const contextBefore = idx > 0 ? fullText.slice(Math.max(0, idx - 40), idx) : '';
    const contextAfter = idx >= 0 ? fullText.slice(idx + text.length, idx + text.length + 40) : '';

    const first = range.getClientRects()[0];
    onSelectionCreated({
      page: pageNumber,
      rects,
      text,
      contextBefore,
      contextAfter,
      x: first.left + first.width / 2,
      y: first.top,
    });
  }

  return (
    <div
      ref={rootRef}
      className={styles.page}
      data-page={pageNumber}
      style={{ width: size.width, height: size.height }}
      onMouseUp={handleMouseUp}
    >
      {active && <canvas ref={canvasRef} className={styles.canvas} style={{ opacity: rendered ? 1 : 0 }} />}
      {active && <div ref={textLayerRef} className={styles.textLayer} style={{ width: size.width, height: size.height }} />}
      {active &&
        highlights.map((a) => {
          const loc = a.location as PdfAnnotationLocation;
          return loc.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className={`${styles.highlight} ${a.id === focusedAnnotationId ? styles.highlightFocused : ''}`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
                background: `var(--color-highlight-${a.color})`,
              }}
            />
          ));
        })}
      {active &&
        searchMatches.map((m, mi) =>
          m.rects.map((r, i) => (
            <div
              key={`${mi}-${i}`}
              className={`${styles.searchMatch} ${m.active ? styles.searchMatchActive : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}
            />
          ))
        )}
    </div>
  );
}
