import type { BookFormat, ReaderSettings, ReaderTheme } from '../types';
import styles from './ReaderSettingsMenu.module.css';

const THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
const FONTS = [
  { id: 'georgia', label: 'Serif' },
  { id: 'system', label: 'Sans' },
];

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

export default function ReaderSettingsMenu({
  format,
  settings,
  onChange,
}: {
  format: BookFormat;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <div className={styles.panel}>
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
          <div className={styles.group}>
            <Stepper label="Margins" value={settings.margin} unit="px" onDecrease={() => onChange({ margin: Math.max(0, settings.margin - 8) })} onIncrease={() => onChange({ margin: Math.min(120, settings.margin + 8) })} />
          </div>
        </>
      )}

      <div className={styles.group}>
        <Stepper label="Reading width" value={settings.readingWidth} unit="px" onDecrease={() => onChange({ readingWidth: Math.max(400, settings.readingWidth - 40) })} onIncrease={() => onChange({ readingWidth: Math.min(1000, settings.readingWidth + 40) })} />
      </div>
    </div>
  );
}
