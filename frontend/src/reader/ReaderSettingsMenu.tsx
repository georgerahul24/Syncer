import { useEffect, useRef } from 'react';
import type { BookFormat, ReaderPadding, ReaderSettings, ReaderTheme } from '../types';
import styles from './ReaderSettingsMenu.module.css';

const THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
const FONTS = [
  { id: 'georgia', label: 'Serif' },
  { id: 'system', label: 'Sans' },
];
const PADDING_MAX = 500;

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

function Slider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={4}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
        aria-label={label}
      />
      <span className={styles.sliderValue}>{value}px</span>
    </div>
  );
}

export default function ReaderSettingsMenu({
  format,
  settings,
  onChange,
  onClose,
}: {
  format: BookFormat;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Dismiss on any click outside the panel — EXCEPT the top bar's own
  // toggle button, which already opens/closes this via its own onClick.
  // Without that exclusion, a click on the toggle while open would first
  // close it here (mousedown fires before click) and then the toggle's
  // onClick would immediately flip it back open, net-cancelling the close.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[aria-label="Reader settings"]')) return;
      onClose();
    }
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  function setPadding(direction: keyof ReaderPadding, value: number) {
    onChange({ padding: { ...settings.padding, [direction]: value } });
  }

  return (
    <div ref={panelRef} className={styles.panel}>
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

      {format === 'epub' && (
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
          <div className={styles.group}>
            <Stepper label="Font size" value={settings.fontSize} unit="px" onDecrease={() => onChange({ fontSize: Math.max(12, settings.fontSize - 1) })} onIncrease={() => onChange({ fontSize: Math.min(32, settings.fontSize + 1) })} />
          </div>
          <div className={styles.group}>
            <Stepper
              label="Line height"
              value={Math.round(settings.lineHeight * 10) / 10}
              onDecrease={() => onChange({ lineHeight: Math.max(1.2, Math.round((settings.lineHeight - 0.1) * 10) / 10) })}
              onIncrease={() => onChange({ lineHeight: Math.min(2.2, Math.round((settings.lineHeight + 0.1) * 10) / 10) })}
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
  );
}
