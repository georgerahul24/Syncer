import type { ReactNode } from 'react';
import styles from './Dialog.module.css';

/** A centered modal panel over a dimmed backdrop. Clicking the backdrop closes it. */
export default function Dialog({
  width,
  onClose,
  labelledBy,
  children,
}: {
  width: number;
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} style={{ width }} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
