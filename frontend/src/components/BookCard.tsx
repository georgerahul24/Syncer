import { useEffect, useState } from 'react';
import type { Book, Folder } from '../types';
import PdfCoverThumbnail from '../reader/pdf/PdfCoverThumbnail';
import { getOfflineCoverUrl } from '../utils/offlineBooks';
import styles from './BookCard.module.css';

export const BOOK_DRAG_MIME = 'application/x-syncer-book-id';

export type OfflineState = { kind: 'none' | 'available' } | { kind: 'downloading'; fraction: number };

export default function BookCard({
  book,
  subtitle,
  folders,
  offlineState,
  onOpen,
  onDelete,
  onOrganize,
  onSetFolder,
  onShowAnalytics,
  onToggleOffline,
}: {
  book: Book;
  subtitle?: string;
  folders: Folder[];
  offlineState: OfflineState;
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
  onOrganize: (book: Book) => void;
  onSetFolder: (book: Book, folderId: string | null) => void;
  onShowAnalytics: (book: Book) => void;
  onToggleOffline: (book: Book) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  // book.coverUrl is a resolved network URL (see api.ts's withResolvedCover)
  // baked in at whatever base/token was active when the library list last
  // loaded — that's stale or simply unreachable offline, even though the
  // cover bytes may already be sitting in the offline cache from a previous
  // download (see LibraryPage's ApiError fallback, which serves cached book
  // metadata — coverUrl included — when the network list fetch fails).
  // Prefer the offline copy whenever one exists so the grid doesn't show a
  // broken-image icon for a book that's fully available offline.
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const progressPct = book.progress ? Math.round(book.progress.progress * 100) : 0;

  useEffect(() => {
    if (book.format !== 'epub' || !book.coverUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setCoverBroken(false);
    getOfflineCoverUrl(book.id).then((offline) => {
      if (cancelled) return;
      if (offline) {
        objectUrl = offline;
        setCoverSrc(offline);
      } else {
        setCoverSrc(book.coverUrl!);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [book.id, book.format, book.coverUrl]);

  function closeMenus() {
    setMenuOpen(false);
    setMoveMenuOpen(false);
  }

  // A brief, deliberate "opening" motion before the reader actually mounts
  // — without this, the click and the page swap (an instant route change,
  // see router.tsx) land in the same tick and any :active/:hover feedback
  // on the cover never has time to actually be seen.
  function open() {
    if (opening) return;
    setOpening(true);
    setTimeout(() => onOpen(book), 150);
  }

  return (
    <div
      className={styles.card}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BOOK_DRAG_MIME, book.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div
        className={`${styles.coverWrap} ${opening ? styles.coverOpening : ''}`}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
      >
        {book.format === 'epub' && coverSrc && !coverBroken ? (
          <img className={styles.cover} src={coverSrc} alt="" loading="lazy" onError={() => setCoverBroken(true)} />
        ) : book.format === 'pdf' ? (
          <PdfCoverThumbnail bookId={book.id} title={book.title} />
        ) : (
          // No cover image (a .txt file, or an EPUB without one): print the
          // title on the blank cover instead of leaving it empty.
          <div className={styles.txtCover}>
            <span className={styles.txtCoverTitle}>{book.title}</span>
          </div>
        )}
        {progressPct > 0 && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
        )}
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Book options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
            setMoveMenuOpen(false);
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
            {!moveMenuOpen ? (
              <>
                <button type="button" onClick={() => setMoveMenuOpen(true)}>
                  Move to…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenus();
                    onOrganize(book);
                  }}
                >
                  Organize…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenus();
                    onShowAnalytics(book);
                  }}
                >
                  Analytics for this book
                </button>
                <button
                  type="button"
                  disabled={offlineState.kind === 'downloading'}
                  onClick={() => {
                    closeMenus();
                    onToggleOffline(book);
                  }}
                >
                  {offlineState.kind === 'available'
                    ? 'Remove offline download'
                    : offlineState.kind === 'downloading'
                      ? `Downloading… ${Math.round(offlineState.fraction * 100)}%`
                      : 'Download for offline'}
                </button>
                <button type="button" className={styles.menuDanger} onClick={() => onDelete(book)}>
                  Delete book
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={book.folderId === null}
                  onClick={() => {
                    closeMenus();
                    onSetFolder(book, null);
                  }}
                >
                  Unfiled
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={book.folderId === f.id}
                    onClick={() => {
                      closeMenus();
                      onSetFolder(book, f.id);
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <div className={styles.title}>{book.title}</div>
      <div className={styles.meta}>{subtitle ?? book.author ?? ' '}</div>
      {book.tags.length > 0 && (
        <div className={styles.tagRow}>
          {book.tags.slice(0, 3).map((t) => (
            <span key={t.id} className={styles.tagChip}>
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
