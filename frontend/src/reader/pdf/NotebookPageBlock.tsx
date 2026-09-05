import { useEffect, useRef, useState } from 'react';
import type { InkStroke, NotebookPage } from '../../types';
import styles from './NotebookPageBlock.module.css';

const COLORS = ['#1a1a1a', '#d64545', '#2563eb', '#16a34a'];
const WIDTHS = [2, 5];
const TEXT_SAVE_DEBOUNCE_MS = 600;

/**
 * A blank page interleaved into the continuous-scroll page list (see
 * PdfReader.tsx). Unlike PdfPage, this is cheap enough to always be fully
 * mounted — no virtualization needed. Ink points are stored as [0,1]
 * fractions of the canvas's own size (same normalization idea as PDF
 * highlight rects), so strokes stay put across zoom-level changes.
 */
export default function NotebookPageBlock({
  page,
  width,
  height,
  onUpdate,
  onDelete,
}: {
  page: NotebookPage;
  width: number;
  height: number;
  onUpdate: (id: string, patch: { text?: string; strokes?: InkStroke[] }) => void;
  onDelete: (id: string) => void;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [color, setColor] = useState(COLORS[0]);
  const [penWidth, setPenWidth] = useState(WIDTHS[0]);
  const [text, setText] = useState(page.text);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<InkStroke[]>(page.strokes);
  const drawingRef = useRef<InkStroke | null>(null);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1];
        const b = stroke.points[i];
        ctx.lineWidth = stroke.width * ((a.pressure + b.pressure) / 2 || 1);
        ctx.beginPath();
        ctx.moveTo(a.x * canvasWidth, a.y * canvasHeight);
        ctx.lineTo(b.x * canvasWidth, b.y * canvasHeight);
        ctx.stroke();
      }
    }
  }

  // Re-render at the canvas's actual backing resolution whenever its CSS
  // size changes (e.g. a zoom-level change resizes every page, this one
  // included) — points are stored as fractions, so they replay correctly.
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
    strokesRef.current = page.strokes;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.strokes]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      pressure: e.pressure > 0 ? e.pressure : 1,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw') return;
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
      onUpdate(page.id, { strokes: next });
    }
    redraw();
  }

  function clearDrawing() {
    if (strokesRef.current.length === 0) return;
    if (!confirm('Clear all drawing on this page? This can\'t be undone.')) return;
    strokesRef.current = [];
    onUpdate(page.id, { strokes: [] });
    redraw();
  }

  function onTextChange(value: string) {
    setText(value);
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => onUpdate(page.id, { text: value }), TEXT_SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    };
  }, []);

  function deletePage() {
    if (!confirm('Delete this notebook page? This can\'t be undone.')) return;
    onDelete(page.id);
  }

  return (
    <div className={styles.page} style={{ width }}>
      <div className={styles.toolbar}>
        <div className={styles.modeGroup}>
          <button type="button" className={mode === 'draw' ? styles.modeActive : ''} onClick={() => setMode('draw')}>
            ✎ Draw
          </button>
          <button type="button" className={mode === 'type' ? styles.modeActive : ''} onClick={() => setMode('type')}>
            Aa Type
          </button>
        </div>
        {mode === 'draw' && (
          <div className={styles.penGroup}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.swatch}
                style={{ background: c, outline: color === c ? '2px solid var(--color-accent)' : 'none' }}
                aria-label={`Pen color ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={penWidth === w ? styles.modeActive : ''}
                aria-label={`Pen width ${w}`}
                onClick={() => setPenWidth(w)}
              >
                <span className={styles.widthDot} style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}
            <button type="button" onClick={clearDrawing}>
              Clear
            </button>
          </div>
        )}
        <button type="button" className={styles.deleteButton} onClick={deletePage} aria-label="Delete notebook page">
          Delete page
        </button>
      </div>
      <div className={styles.canvasWrap} style={{ height }}>
        <textarea
          className={styles.textarea}
          style={{ pointerEvents: mode === 'type' ? 'auto' : 'none' }}
          placeholder="Type a note…"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width, height, pointerEvents: mode === 'draw' ? 'auto' : 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  );
}
