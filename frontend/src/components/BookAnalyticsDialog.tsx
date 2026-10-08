import { useEffect, useState } from 'react';
import type { Book, BookStats } from '../types';
import { analytics } from '../services/api';
import { formatDuration } from '../utils/time';
import styles from './BookAnalyticsDialog.module.css';

export default function BookAnalyticsDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [stats, setStats] = useState<BookStats | null>(null);

  useEffect(() => {
    analytics.forBook(book.id).then(setStats).catch(() => {});
  }, [book.id]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Analytics — &ldquo;{book.title}&rdquo;</h2>

        {!stats ? null : stats.sessionCount === 0 ? (
          <p className={styles.empty}>No reading sessions recorded yet.</p>
        ) : (
          <div className={styles.grid}>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatDuration(stats.totalSeconds)}</div>
              <div className={styles.tileLabel}>Time read</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{Math.round(stats.maxProgress * 100)}%</div>
              <div className={styles.tileLabel}>Progress</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{stats.pagesRead.toLocaleString()}</div>
              <div className={styles.tileLabel}>Pages read</div>
              {stats.isEstimate.pagesRead && <div className={styles.tileNote}>Estimated</div>}
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatDuration(stats.avgSessionSeconds)}</div>
              <div className={styles.tileLabel}>Avg. session</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{stats.sessionCount}</div>
              <div className={styles.tileLabel}>Sessions</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{stats.estimatedCharactersRead.toLocaleString()}</div>
              <div className={styles.tileLabel}>Characters read</div>
              <div className={styles.tileNote}>Estimated</div>
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
