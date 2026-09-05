import { useState } from 'react';
import type { Book, Folder } from '../types';
import PdfCoverThumbnail from '../reader/pdf/PdfCoverThumbnail';
import styles from './BookCard.module.css';

export const BOOK_DRAG_MIME = 'application/x-syncer-book-id';

export default function BookCard({
  book,
  subtitle,
  folders,
  onOpen,
  onDelete,
  onOrganize,
  onSetFolder,
  onShowAnalytics,
}: {
  book: Book;
  subtitle?: string;
  folders: Folder[];
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
  onOrganize: (book: Book) => void;
  onSetFolder: (book: Book, folderId: string | null) => void;
  onShowAnalytics: (book: Book) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const progressPct = book.progress ? Math.round(book.progress.progress * 100) : 0;

  function closeMenus() {
    setMenuOpen(false);
    setMoveMenuOpen(false);
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
        className={styles.coverWrap}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(book)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(book)}
      >
        {book.format === 'epub' && book.coverUrl ? (
          <img className={styles.cover} src={book.coverUrl} alt="" loading="lazy" />
        ) : book.format === 'pdf' ? (
          <PdfCoverThumbnail bookId={book.id} title={book.title} />
        ) : (
          <div className={styles.cover} />
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
