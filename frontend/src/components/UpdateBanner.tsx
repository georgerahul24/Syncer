import { useEffect } from 'react';
import { dismissUpdate, installUpdate, type UpdateState } from '../services/appUpdate';
import styles from './UpdateBanner.module.css';

export default function UpdateBanner({ update }: { update: UpdateState }) {
  // Result of a manual check: say it, then get out of the way.
  useEffect(() => {
    if (update.state !== 'up-to-date') return;
    const t = setTimeout(dismissUpdate, 3000);
    return () => clearTimeout(t);
  }, [update]);

  if (update.state === 'idle') return null;
  return (
    <div className={styles.banner} role="status">
      {update.state === 'checking' && <span className={styles.text}>Checking for updates…</span>}
      {update.state === 'up-to-date' && <span className={styles.text}>Syncer {update.version} is the latest version</span>}
      {update.state === 'available' && (
        <>
          <span className={styles.text}>Syncer {update.version} is available</span>
          <button type="button" className={styles.later} onClick={dismissUpdate}>
            Later
          </button>
          <button type="button" className={styles.primary} onClick={installUpdate}>
            Update
          </button>
        </>
      )}
      {update.state === 'installing' && (
        <span className={styles.text}>
          Updating to {update.version}
          {update.progress !== null ? ` · ${Math.round(update.progress * 100)}%` : '…'}
        </span>
      )}
      {update.state === 'failed' && (
        <>
          <span className={styles.text}>{update.message}</span>
          <button type="button" className={styles.later} onClick={dismissUpdate}>
            OK
          </button>
        </>
      )}
    </div>
  );
}
