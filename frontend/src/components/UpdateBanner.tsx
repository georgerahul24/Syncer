import type { AppUpdate } from '../hooks/useAppUpdate';
import styles from './UpdateBanner.module.css';

export default function UpdateBanner({ update }: { update: AppUpdate | null }) {
  if (!update) return null;
  return (
    <div className={styles.banner} role="status">
      {update.state === 'available' && (
        <>
          <span className={styles.text}>Syncer {update.version} is available</span>
          <button type="button" className={styles.later} onClick={update.dismiss}>
            Later
          </button>
          <button type="button" className={styles.primary} onClick={update.install}>
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
          <button type="button" className={styles.later} onClick={update.dismiss}>
            OK
          </button>
        </>
      )}
    </div>
  );
}
