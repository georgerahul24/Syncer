import { useEffect, useRef } from 'react';
import type { InkStroke } from '../../types';

/**
 * Freehand ink layer shared by NotebookPageBlock.tsx (a blank inserted
 * page) and PdfPage.tsx (drawing directly on top of real page content) —
 * same canvas/pointer-event/normalization logic either way, just a
 * different host. Points are stored as [0,1] fractions of the canvas's own
 * size (same idea as PDF highlight rects), so strokes stay put across
 * zoom-level changes.
 *
 * Deliberately uniform line width — no pressure sensitivity. A stylus's
 * light default pressure vs. a finger/mouse's fixed pressure=1 made the
 * same pen draw pencil-thin on one input and thick on the other; a single
 * fixed width per stroke reads as the same pen regardless of input device.
 */
export default function InkCanvas({
  width,
  height,
  strokes,
  editable,
  color,
  penWidth,
  onStrokesChange,
  className,
  style,
}: {
  width: number;
  height: number;
  strokes: InkStroke[];
  editable: boolean;
  color: string;
  penWidth: number;
  onStrokesChange: (strokes: InkStroke[]) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<InkStroke[]>(strokes);
  const drawingRef = useRef<InkStroke | null>(null);

  const canvasWidth = Math.max(1, width);
  const canvasHeight = Math.max(1, height);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = drawingRef.current ? [...strokesRef.current, drawingRef.current] : strokesRef.current;
    for (const stroke of all) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * canvasWidth, stroke.points[0].y * canvasHeight);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * canvasWidth, stroke.points[i].y * canvasHeight);
      }
      ctx.stroke();
    }
  }

  // Re-render at the canvas's actual backing resolution whenever its CSS
  // size changes (e.g. a zoom-level change resizes every page) — points
  // are stored as fractions, so they replay correctly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    strokesRef.current = strokes;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { color, width: penWidth, points: [pointFromEvent(e)] };
    redraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(pointFromEvent(e));
    redraw();
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    const finished = drawingRef.current;
    drawingRef.current = null;
    if (finished.points.length >= 2) {
      const next = [...strokesRef.current, finished];
      strokesRef.current = next;
      onStrokesChange(next);
    }
    redraw();
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, touchAction: 'none', pointerEvents: editable ? 'auto' : 'none', ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  );
}

