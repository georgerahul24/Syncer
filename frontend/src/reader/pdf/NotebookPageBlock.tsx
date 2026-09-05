import { useEffect, useRef, useState } from 'react';
import type { InkStroke, NotebookPage } from '../../types';
import InkCanvas from './InkCanvas';
import { INK_COLORS, INK_WIDTHS } from './inkConstants';
import styles from './NotebookPageBlock.module.css';

const TEXT_SAVE_DEBOUNCE_MS = 600;

/**
 * A blank page interleaved into the continuous-scroll page list (see
 * PdfReader.tsx). Unlike PdfPage, this is cheap enough to always be fully
 * mounted — no virtualization needed.
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
  onUpdate: (id: string, patch: { text?: string; strokes?: InkStroke[] }) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [color, setColor] = useState(INK_COLORS[0]);
  const [penWidth, setPenWidth] = useState(INK_WIDTHS[0]);
  const [text, setText] = useState(page.text);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function save(patch: { text?: string; strokes?: InkStroke[] }) {
    setSaveState('saving');
    onUpdate(page.id, patch)
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('error'));
  }

  function onStrokesChange(strokes: InkStroke[]) {
    save({ strokes });
  }

  function clearDrawing() {
    if (page.strokes.length === 0) return;
    if (!confirm("Clear all drawing on this page? This can't be undone.")) return;
    save({ strokes: [] });
  }

  function onTextChange(value: string) {
    setText(value);
    setSaveState('saving');
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => save({ text: value }), TEXT_SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    };
  }, []);

  function deletePage() {
    if (!confirm("Delete this notebook page? This can't be undone.")) return;
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
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.swatch}
                style={{ background: c, outline: color === c ? '2px solid var(--color-accent)' : 'none' }}
                aria-label={`Pen color ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
            {INK_WIDTHS.map((w) => (
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
        <span className={styles.saveStatus}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save' : 'Saved'}
        </span>
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
        <InkCanvas
          className={styles.canvas}
          width={width}
          height={height}
          strokes={page.strokes}
          editable={mode === 'draw'}
          color={color}
          penWidth={penWidth}
          onStrokesChange={onStrokesChange}
        />
      </div>
    </div>
  );
}
