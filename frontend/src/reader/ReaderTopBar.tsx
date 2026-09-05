import type { Book } from '../types';
import type { ConnectionState } from './sync/useReaderSync';
import styles from './ReaderTopBar.module.css';

export function PersistentSyncDot({ connectionState, effectiveSyncEnabled }: { connectionState: ConnectionState; effectiveSyncEnabled: boolean }) {
  // Section 33: controls may fade out, but sync status must never be
  // *permanently* hidden — this small dot stays visible regardless of
  // ReaderTopBar's own visibility.
  const cls =
    connectionState === 'reconnecting'
      ? styles.persistentDotReconnecting
      : !effectiveSyncEnabled
        ? styles.persistentDotPaused
        : '';
  return <div className={`${styles.persistentDot} ${cls}`} title={effectiveSyncEnabled ? 'Synced' : 'Sync paused'} />;
}

export default function ReaderTopBar({
  visible,
  book,
  connectionState,
  userSyncEnabled,
  bookSyncEnabled,
  sessionSyncEnabled,
  onToggleSessionSync,
  onToggleBookSync,
  onBack,
  onOpenToc,
  onOpenSearch,
  onOpenAnnotations,
  onOpenSettings,
  isFullscreen,
  onToggleFullscreen,
}: {
  visible: boolean;
  book: Book;
  connectionState: ConnectionState;
  userSyncEnabled: boolean;
  bookSyncEnabled: boolean;
  sessionSyncEnabled: boolean;
  onToggleSessionSync: (enabled: boolean) => void;
  onToggleBookSync: (enabled: boolean) => void;
  onBack: () => void;
  onOpenToc: () => void;
  onOpenSearch: () => void;
  onOpenAnnotations: () => void;
  onOpenSettings: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  let syncLabel: string;
  let syncAction: { label: string; onClick: () => void } | null = null;
  let dotClass = '';
  if (connectionState === 'reconnecting') {
    syncLabel = 'Reconnecting…';
    dotClass = styles.syncDotReconnecting;
  } else if (!userSyncEnabled) {
    syncLabel = 'Sync off';
  } else if (!bookSyncEnabled) {
    syncLabel = 'Sync off for this book';
    syncAction = { label: 'Turn on', onClick: () => onToggleBookSync(true) };
    dotClass = styles.syncDotPaused;
  } else if (!sessionSyncEnabled) {
    syncLabel = 'Sync paused';
    syncAction = { label: 'Resume sync', onClick: () => onToggleSessionSync(true) };
    dotClass = styles.syncDotPaused;
  } else {
    syncLabel = 'Synced';
    syncAction = { label: 'Desync', onClick: () => onToggleSessionSync(false) };
  }

  return (
    <div className={`${styles.bar} ${visible ? '' : styles.hidden}`}>
      <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back to library">
        ←
      </button>
      <span className={styles.title}>{book.title}</span>
      <div className={styles.syncPill}>
        <span className={`${styles.syncDot} ${dotClass}`} />
        <span>{syncLabel}</span>
        {syncAction && (
          <button type="button" className={styles.syncAction} onClick={syncAction.onClick}>
            {syncAction.label}
          </button>
        )}
      </div>
      <button type="button" className={styles.iconButton} onClick={onOpenToc} aria-label="Table of contents">
        ☰
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenSearch} aria-label="Search in book">
        🔍
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenAnnotations} aria-label="Annotations">
        ✎
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenSettings} aria-label="Reader settings">
        Aa
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? '⤡' : '⤢'}
      </button>
    </div>
  );
}
