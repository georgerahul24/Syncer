import { useState } from 'react';
import type { Book, Folder } from '../types';
import styles from './OrganizeBookDialog.module.css';

export default function OrganizeBookDialog({
  book,
  folders,
  onClose,
  onSetFolder,
  onAddTag,
  onRemoveTag,
}: {
  book: Book;
  folders: Folder[];
  onClose: () => void;
  onSetFolder: (folderId: string | null) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
}) {
  const [tagDraft, setTagDraft] = useState('');

  function submitTag() {
    const name = tagDraft.trim();
    if (name) onAddTag(name);
    setTagDraft('');
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Organize &ldquo;{book.title}&rdquo;</h2>

        <div className={styles.group}>
          <div className={styles.label}>Folder</div>
          <select className={styles.select} value={book.folderId ?? ''} onChange={(e) => onSetFolder(e.target.value || null)}>
            <option value="">None</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.group}>
          <div className={styles.label}>Tags</div>
          <div className={styles.tagList}>
            {book.tags.map((t) => (
              <span key={t.id} className={styles.tagPill}>
                {t.name}
                <button type="button" className={styles.tagRemove} onClick={() => onRemoveTag(t.id)} aria-label={`Remove tag ${t.name}`}>
                  ✕
                </button>
              </span>
            ))}
            {book.tags.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>No tags yet</span>}
          </div>
          <div className={styles.tagInputRow}>
            <input
              className={styles.tagInput}
              placeholder="Add a tag…"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitTag()}
            />
            <button type="button" className={styles.addTagButton} onClick={submitTag}>
              Add
            </button>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
