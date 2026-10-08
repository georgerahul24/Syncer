import { useEffect, useRef, useState } from 'react';
import type { BookFormat, ReaderPadding, ReaderSettings, ReaderTheme } from '../types';
import styles from './ReaderSettingsMenu.module.css';

const THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
const FONTS = [
  { id: 'georgia', label: 'Serif' },
  { id: 'system', label: 'Sans' },
];
// Deliberately far past any phone's width: one stored setting has to serve a
// 400px phone and a 2560px desktop, and a maximum low enough to be always-safe
// on the phone would make the control useless on the desktop. Readers fit the
// value to the screen they're actually on — see reader/padding.ts.
const PADDING_MAX = 1000;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 72;
const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 3;

function Stepper({ label, value, unit, onDecrease, onIncrease }: { label: string; value: number; unit?: string; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div className={styles.stepperRow}>
      <span>{label}</span>
      <div className={styles.stepper}>
        <button type="button" onClick={onDecrease} aria-label={`Decrease ${label}`}>
          −
        </button>
        <span className={styles.stepperValue}>{value}{unit}</span>
        <button type="button" onClick={onIncrease} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

// Committing a change here cascades into an expensive re-layout (PDF.js
// rescales every page, epub.js clears and re-renders the chapter), so this
// keeps a `local` value for instant thumb/label feedback and throttles the
// real onChange through rAF. The readers debounce the heaviest part again on
// their own side — see EpubReader's resize effect.
//
// What it must NOT do is defer that onChange to `pointerup` alone, which is
// what it used to do. A pointer gesture does not reliably end in `pointerup`:
// if anything else claims the gesture — a scroll, the page-level touch
// handlers this reader has on its own container — the browser fires
// `pointercancel` instead and no `pointerup` ever arrives. The drag then
// showed the thumb moving (local state) and silently threw the value away,
// which is exactly the "slider flickers and snaps back, padding never
// applies" behaviour. Touch was worse than mouse, and the horizontal
// sliders worse than the vertical ones, because a horizontal drag is the
// gesture most likely to be mistaken for a scroll.
//
// So: commit continuously (throttled through rAF, which coalesces to one
// per frame no matter how fast the input fires), and commit again on every
// way a gesture can end. Nothing depends on a single event arriving.
function Slider({ label, value, min = 0, max, step = 4, unit = 'px', onChange }: { label: string; value: number; min?: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const [local, setLocal] = useState(value);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Accept outside changes (a reset, another control) — but never while the
  // user has hold of this slider, or their in-progress drag would fight the
  // value echoing back from the parent.
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  function scheduleCommit(next: number) {
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current !== null) onChangeRef.current(pendingRef.current);
    });
  }

  function endDrag() {
    draggingRef.current = false;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (pendingRef.current !== null) {
      onChangeRef.current(pendingRef.current);
      pendingRef.current = null;
    }
  }

  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onPointerDown={() => (draggingRef.current = true)}
        onChange={(e) => {
          const next = Number(e.target.value);
          setLocal(next);
          scheduleCommit(next);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyUp={endDrag}
        onBlur={endDrag}
        className={styles.slider}
        aria-label={label}
      />
      <span className={styles.sliderValue}>{local}{unit}</span>
    </div>
  );
}

export default function ReaderSettingsMenu({
  open,
  format,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  format: BookFormat;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}) {
  // Dismiss on any click outside the panel via a full-viewport backdrop,
  // rather than a window-level 'mousedown' listener: EPUB content renders
  // inside epub.js's own iframe, and a click landing there fires inside
  // that iframe's own document — it never bubbles out to a listener on the
  // parent window at all, so a plain outside-click listener silently never
  // sees taps on the book itself (the single most likely place to tap to
  // dismiss a menu that's covering the page). The backdrop sits in front
  // of the iframe instead, so it intercepts the click directly.
  function onBackdropPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onClose();
  }

  function setPadding(direction: keyof ReaderPadding, value: number) {
    onChange({ padding: { ...settings.padding, [direction]: value } });
  }

  return (
    <>
      {open && <div className={styles.backdrop} onPointerDown={onBackdropPointerDown} />}
      <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`} aria-hidden={!open}>
      <div className={styles.group}>
        <div className={styles.label}>Theme</div>
        <div className={styles.segmented}>
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={settings.theme === t ? styles.segmentedActive : ''}
              onClick={() => onChange({ theme: t })}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.label}>Layout</div>
        <div className={styles.segmented}>
          <button type="button" className={settings.mode === 'continuous' ? styles.segmentedActive : ''} onClick={() => onChange({ mode: 'continuous' })}>
            Scroll
          </button>
          <button type="button" className={settings.mode === 'paginated' ? styles.segmentedActive : ''} onClick={() => onChange({ mode: 'paginated' })}>
            Pages
          </button>
        </div>
      </div>

      {format === 'pdf' && (
        <div className={styles.group}>
          <div className={styles.label}>Zoom</div>
          <select
            className={styles.select}
            value={typeof settings.pdfZoom === 'number' ? 'custom' : settings.pdfZoom}
            onChange={(e) => onChange({ pdfZoom: e.target.value === 'custom' ? 1 : (e.target.value as 'fit-width' | 'fit-page') })}
          >
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
          </select>
        </div>
      )}

      {(format === 'epub' || format === 'txt') && (
        <>
          <div className={styles.group}>
            <div className={styles.label}>Font</div>
            <select className={styles.select} value={settings.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {/* A slider, not the +/- stepper this used to be: the range now spans
              10-72px, and stepping that one tap at a time is 60-odd taps. */}
          <div className={styles.group}>
            <div className={styles.label}>Text size</div>
            <Slider
              label="Size"
              value={settings.fontSize}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              onChange={(v) => onChange({ fontSize: v })}
            />
          </div>
          <div className={styles.group}>
            <Stepper
              label="Line height"
              value={Math.round(settings.lineHeight * 10) / 10}
              onDecrease={() => onChange({ lineHeight: Math.max(LINE_HEIGHT_MIN, Math.round((settings.lineHeight - 0.1) * 10) / 10) })}
              onIncrease={() => onChange({ lineHeight: Math.min(LINE_HEIGHT_MAX, Math.round((settings.lineHeight + 0.1) * 10) / 10) })}
            />
          </div>
        </>
      )}

      <div className={styles.group}>
        <div className={styles.label}>Padding</div>
        <Slider label="Top" value={settings.padding.top} max={PADDING_MAX} onChange={(v) => setPadding('top', v)} />
        <Slider label="Right" value={settings.padding.right} max={PADDING_MAX} onChange={(v) => setPadding('right', v)} />
        <Slider label="Bottom" value={settings.padding.bottom} max={PADDING_MAX} onChange={(v) => setPadding('bottom', v)} />
        <Slider label="Left" value={settings.padding.left} max={PADDING_MAX} onChange={(v) => setPadding('left', v)} />
      </div>
      </div>
    </>
  );
}
