import type { Book } from '../types';
import {
  IconAnnotate,
  IconBack,
  IconCollapse,
  IconContents,
  IconDownload,
  IconDownloaded,
  IconDownloading,
  IconExpand,
  IconSearch,
  IconType,
} from './icons';
import type { ConnectionState } from './sync/useReaderSync';
import styles from './ReaderTopBar.module.css';

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
  offlineState,
  onToggleOffline,
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
  /** 'available' once the file/cover are downloaded for offline reading; 'downloading' carries 0-1 progress. */
  offlineState: { kind: 'none' | 'available' } | { kind: 'downloading'; fraction: number };
  onToggleOffline: () => void;
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
        <IconBack />
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
      <button
        type="button"
        onClick={onToggleOffline}
        disabled={offlineState.kind === 'downloading'}
        aria-label={offlineState.kind === 'available' ? 'Remove offline copy' : 'Download for offline reading'}
        title={
          offlineState.kind === 'available'
            ? 'Available offline — tap to remove'
            : offlineState.kind === 'downloading'
              ? `Downloading… ${Math.round(offlineState.fraction * 100)}%`
              : 'Download for offline reading'
        }
        className={`${styles.iconButton} ${offlineState.kind === 'downloading' ? styles.spinning : ''}`}
      >
        {offlineState.kind === 'available' ? <IconDownloaded /> : offlineState.kind === 'downloading' ? <IconDownloading /> : <IconDownload />}
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenToc} aria-label="Table of contents">
        <IconContents />
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenSearch} aria-label="Search in book">
        <IconSearch />
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenAnnotations} aria-label="Annotations">
        <IconAnnotate />
      </button>
      <button type="button" className={styles.iconButton} onClick={onOpenSettings} aria-label="Reader settings">
        <IconType />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? <IconCollapse /> : <IconExpand />}
      </button>
    </div>
  );
}
