import type { TocItem } from '../types';
import styles from './TocPanel.module.css';

function Rows({ items, depth, onSelect }: { items: TocItem[]; depth: number; onSelect: (item: TocItem) => void }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i}>
          <button type="button" className={styles.item} style={{ paddingLeft: `${16 + depth * 16}px` }} onClick={() => onSelect(item)}>
            {item.label}
          </button>
          {item.items && item.items.length > 0 && <Rows items={item.items} depth={depth + 1} onSelect={onSelect} />}
        </div>
      ))}
    </>
  );
}

export default function TocPanel({
  open,
  toc,
  onClose,
  onSelect,
}: {
  open: boolean;
  toc: TocItem[];
  onClose: () => void;
  onSelect: (item: TocItem) => void;
}) {
  return (
    <aside className={`${styles.panel} ${open ? styles.panelOpen : ''}`} aria-hidden={!open}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Contents</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close table of contents">
          ✕
        </button>
      </div>
      <div className={styles.list}>
        {toc.length === 0 ? (
          <p className={styles.emptyState}>No table of contents available.</p>
        ) : (
          <Rows items={toc} depth={0} onSelect={onSelect} />
        )}
      </div>
    </aside>
  );
}
