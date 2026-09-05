import { useMemo, useState } from 'react';
import type { Annotation, AnnotationColor, TocItem } from '../../types';
import { resolveChapterLabel } from './chapterLabel';
import NoteEditor from './NoteEditor';
import styles from './AnnotationPanel.module.css';

const COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple'];
const COLOR_VAR: Record<AnnotationColor, string> = {
  yellow: 'var(--color-highlight-yellow)',
  green: 'var(--color-highlight-green)',
  blue: 'var(--color-highlight-blue)',
  pink: 'var(--color-highlight-pink)',
  purple: 'var(--color-highlight-purple)',
};

type Filter = 'all' | 'highlights' | 'notes' | AnnotationColor;

export default function AnnotationPanel({
  open,
  annotations,
  toc,
  onClose,
  onNavigate,
  onUpdateNote,
  onUpdateColor,
  onDelete,
}: {
  open: boolean;
  annotations: Annotation[];
  toc: TocItem[];
  onClose: () => void;
  onNavigate: (annotation: Annotation) => void;
  onUpdateNote: (id: string, note: string) => void;
  onUpdateColor: (id: string, color: AnnotationColor) => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    return annotations.filter((a) => {
      if (filter === 'all') return true;
      if (filter === 'highlights') return a.type === 'highlight';
      if (filter === 'notes') return !!a.note;
      return a.color === filter;
    });
  }, [annotations, filter]);

  const groups = useMemo(() => {
    const byChapter = new Map<string, Annotation[]>();
    for (const a of filtered) {
      const label = resolveChapterLabel(a, toc);
      if (!byChapter.has(label)) byChapter.set(label, []);
      byChapter.get(label)!.push(a);
    }
    return Array.from(byChapter.entries());
  }, [filtered, toc]);

  return (
    <aside className={`${styles.panel} ${open ? styles.panelOpen : ''}`} aria-hidden={!open}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Annotations</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close annotations">
          ✕
        </button>
      </div>
      <div className={styles.filters}>
        {(['all', 'highlights', 'notes'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.filterButton} ${filter === f ? styles.filterButtonActive : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'highlights' ? 'Highlights' : 'Notes'}
          </button>
        ))}
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.colorDot}
            style={{ '--swatch-color': COLOR_VAR[c] } as React.CSSProperties}
            aria-label={`Filter by ${c}`}
            onClick={() => setFilter((f) => (f === c ? 'all' : c))}
          >
            {filter === c && <span className={styles.colorDotActive} />}
          </button>
        ))}
      </div>
      <div className={styles.list}>
        {groups.length === 0 && <p className={styles.emptyState}>No annotations yet. Select text to highlight it.</p>}
        {groups.map(([chapter, items]) => (
          <div key={chapter}>
            <div className={styles.chapterHeading}>{chapter}</div>
            {items.map((a) => (
              <div key={a.id} className={styles.item} style={{ borderLeftColor: COLOR_VAR[a.color] }}>
                <div onClick={() => onNavigate(a)}>
                  {a.selectedText && (
                    <p className={styles.quote} style={{ '--swatch-color': COLOR_VAR[a.color] } as React.CSSProperties}>
                      &ldquo;{a.selectedText}&rdquo;
                    </p>
                  )}
                </div>
                <NoteEditor
                  className={styles.noteInput}
                  value={a.note ?? ''}
                  onChange={(note) => onUpdateNote(a.id, note)}
                />
                <div className={styles.itemFooter}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`${styles.colorDot} ${a.color === c ? styles.colorDotActive : ''}`}
                      style={{ '--swatch-color': COLOR_VAR[c] } as React.CSSProperties}
                      aria-label={`Set color ${c}`}
                      onClick={() => onUpdateColor(a.id, c)}
                    />
                  ))}
                  <button type="button" className={styles.deleteButton} onClick={() => onDelete(a.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
