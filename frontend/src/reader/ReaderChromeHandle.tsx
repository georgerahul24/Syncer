import type { ConnectionState } from './sync/useReaderSync';
import styles from './ReaderChromeHandle.module.css';

/**
 * The only thing on screen while reading: a small bar at the top edge that
 * brings the reader chrome back when tapped, and otherwise stays out of the
 * way. It replaces the old always-on sync dot rather than sitting alongside
 * it — sync state is carried by this bar's own colour, so the reader has one
 * persistent marker instead of two.
 *
 * It is a traffic light for one question — "is my reading position actually
 * being saved?" — so a glance at the same pixels that open the menu answers
 * it: green synced, amber reconnecting (it should recover on its own), red
 * not syncing at all (turned off, or paused for this session/book).
 */
export default function ReaderChromeHandle({
  visible,
  onReveal,
  connectionState,
  effectiveSyncEnabled,
}: {
  /** False while the full chrome is up — the handle steps aside rather than overlapping the top bar. */
  visible: boolean;
  onReveal: () => void;
  connectionState: ConnectionState;
  effectiveSyncEnabled: boolean;
}) {
  const stateClass =
    connectionState === 'reconnecting' ? styles.reconnecting : !effectiveSyncEnabled ? styles.off : '';
  const label =
    connectionState === 'reconnecting'
      ? 'Reconnecting — show reader controls'
      : effectiveSyncEnabled
        ? 'Synced — show reader controls'
        : 'Sync off — show reader controls';

  return (
    <button
      type="button"
      className={`${styles.hitArea} ${visible ? '' : styles.hidden}`}
      aria-label={label}
      title={label}
      // Pointer-down rather than click: this is a "get the menu up" gesture,
      // and waiting for a full press-and-release makes it feel unresponsive
      // when the actual target is a few pixels tall.
      onPointerDown={(e) => {
        e.stopPropagation();
        onReveal();
      }}
      onFocus={onReveal}
    >
      <span className={`${styles.bar} ${stateClass}`} />
    </button>
  );
}
