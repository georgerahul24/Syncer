import type { AnnotationColor } from '../../types';
import styles from './HighlightPopup.module.css';

export const COLOR_VAR: Record<AnnotationColor, string> = {
  yellow: 'var(--color-highlight-yellow)',
  green: 'var(--color-highlight-green)',
  blue: 'var(--color-highlight-blue)',
  pink: 'var(--color-highlight-pink)',
  purple: 'var(--color-highlight-purple)',
};

const COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];

export default function HighlightPopup({ x, y, onPick }: { x: number; y: number; onPick: (color: AnnotationColor) => void }) {
  return (
    <div className={styles.popup} style={{ left: x, top: y }}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={styles.swatch}
          style={{ '--swatch-color': COLOR_VAR[c] } as React.CSSProperties}
          aria-label={`Highlight ${c}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}
