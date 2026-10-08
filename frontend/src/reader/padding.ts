import { useEffect, useState } from 'react';
import type { ReaderPadding } from '../types';

/**
 * The narrowest strip of actual page we will leave after padding, per axis.
 * Below this a book stops being readable, and at zero the EPUB renderer is
 * handed a degenerate box and lays out nothing at all.
 */
const MIN_CONTENT_PX = 160;

/**
 * Scales a padding pair down proportionally so it can never eat more of the
 * axis than it's allowed to.
 *
 * Proportionally, not by clamping each side independently: an asymmetric
 * setting (say 400 left / 80 right) is a deliberate choice about where the
 * text sits, and clamping only the larger side would silently re-centre the
 * page. Scaling both keeps the ratio the reader chose.
 */
function fitAxis(start: number, end: number, extent: number): [number, number] {
  const total = start + end;
  const allowed = Math.max(0, extent - MIN_CONTENT_PX);
  if (total <= allowed || total === 0) return [start, end];
  const factor = allowed / total;
  return [Math.floor(start * factor), Math.floor(end * factor)];
}

/**
 * The padding to actually render, given the space available.
 *
 * The sliders go far wider than any phone, on purpose — the same setting has
 * to serve a 400px phone and a 2560px desktop, and a maximum low enough to be
 * always-safe on the phone would make the control useless on the desktop. So
 * the stored value is the reader's intent and this is what survives contact
 * with the current screen: on a wide window it passes straight through, and on
 * a narrow one it shrinks to fit instead of collapsing the page.
 */
export function clampPadding(padding: ReaderPadding, width: number, height: number): ReaderPadding {
  const [left, right] = fitAxis(padding.left, padding.right, width);
  const [top, bottom] = fitAxis(padding.top, padding.bottom, height);
  return { top, right, bottom, left };
}

/** Current window size, for readers that fill the viewport and so don't need to measure a box of their own. */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return size;
}
