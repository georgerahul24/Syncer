import { useState } from 'react';
import type { Book } from '../types';
import PdfCoverThumbnail from '../reader/pdf/PdfCoverThumbnail';
import styles from './BookCard.module.css';

export default function BookCard({
  book,
  subtitle,
  onOpen,
  onDelete,
  onOrganize,
}: {
  book: Book;
  subtitle?: string;
  onOpen: (book: Book) => void;
  onDelete: (book: Book) => void;
  onOrganize: (book: Book) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const progressPct = book.progress ? Math.round(book.progress.progress * 100) : 0;

  return (
    <div className={styles.card}>
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
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOrganize(book);
              }}
            >
              Organize…
            </button>
            <button type="button" className={styles.menuDanger} onClick={() => onDelete(book)}>
              Delete book
            </button>
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
