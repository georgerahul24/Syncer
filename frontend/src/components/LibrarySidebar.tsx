import { useState } from 'react';
import type { Folder, Tag } from '../types';
import { BOOK_DRAG_MIME } from './BookCard';
import styles from './LibrarySidebar.module.css';

export type LibraryFilter = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; id: string } | { kind: 'tag'; name: string };

function filtersEqual(a: LibraryFilter, b: LibraryFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
  if (a.kind === 'tag' && b.kind === 'tag') return a.name === b.name;
  return true;
}

export default function LibrarySidebar({
  folders,
  tags,
  filter,
  onFilterChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDeleteTag,
  onDropBook,
}: {
  folders: Folder[];
  tags: Tag[];
  filter: LibraryFilter;
  onFilterChange: (f: LibraryFilter) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteTag: (id: string) => void;
  onDropBook: (bookId: string, folderId: string | null) => void;
}) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  function dropTargetProps(key: string, folderId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(BOOK_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverKey !== key) setDragOverKey(key);
      },
      onDragLeave: () => setDragOverKey((k) => (k === key ? null : k)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverKey(null);
        const bookId = e.dataTransfer.getData(BOOK_DRAG_MIME);
        if (bookId) onDropBook(bookId, folderId);
      },
    };
  }

  function submitNewFolder() {
    const name = newFolderName.trim();
    if (name) onCreateFolder(name);
    setNewFolderName('');
    setAddingFolder(false);
  }

  function submitRename(id: string) {
    const name = editingName.trim();
    if (name) onRenameFolder(id, name);
    setEditingFolderId(null);
  }

  const totalBooks = folders.reduce((sum, f) => sum + f.bookCount, 0);

  return (
    <nav className={styles.sidebar}>
      <button type="button" className={`${styles.item} ${filter.kind === 'all' ? styles.itemActive : ''}`} onClick={() => onFilterChange({ kind: 'all' })}>
        <span className={styles.itemLabel}>All Books</span>
      </button>
      <button
        type="button"
        className={`${styles.item} ${filter.kind === 'unfiled' ? styles.itemActive : ''} ${dragOverKey === 'unfiled' ? styles.itemDragOver : ''}`}
        onClick={() => onFilterChange({ kind: 'unfiled' })}
        {...dropTargetProps('unfiled', null)}
      >
        <span className={styles.itemLabel}>Unfiled</span>
      </button>

      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Folders</span>
        <button type="button" className={styles.addButton} onClick={() => setAddingFolder(true)} aria-label="New folder">
          +
        </button>
      </div>

      {folders.map((f) => (
        <div key={f.id} className={styles.folderRow}>
          {editingFolderId === f.id ? (
            <div className={styles.item}>
              <input
                autoFocus
                className={styles.inlineInput}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => submitRename(f.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(f.id);
                  if (e.key === 'Escape') setEditingFolderId(null);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.item} ${filtersEqual(filter, { kind: 'folder', id: f.id }) ? styles.itemActive : ''} ${dragOverKey === f.id ? styles.itemDragOver : ''}`}
              onClick={() => onFilterChange({ kind: 'folder', id: f.id })}
              onDoubleClick={() => {
                setEditingFolderId(f.id);
                setEditingName(f.name);
              }}
              {...dropTargetProps(f.id, f.id)}
            >
              <span className={styles.itemLabel}>{f.name}</span>
              <span className={styles.count}>{f.bookCount}</span>
              <span className={styles.rowActions}>
                <span
                  role="button"
                  tabIndex={0}
                  className={styles.rowActionButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete folder "${f.name}"? Books inside will become unfiled.`)) onDeleteFolder(f.id);
                  }}
                >
                  ✕
                </span>
              </span>
            </button>
          )}
        </div>
      ))}
      {addingFolder && (
        <div className={styles.item}>
          <input
            autoFocus
            className={styles.inlineInput}
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={submitNewFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewFolder();
              if (e.key === 'Escape') setAddingFolder(false);
            }}
          />
        </div>
      )}
      {folders.length === 0 && !addingFolder && totalBooks === 0 && null}

      {tags.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>Tags</span>
          </div>
          <div className={styles.tagCloud}>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.tagPill} ${filtersEqual(filter, { kind: 'tag', name: t.name }) ? styles.tagPillActive : ''}`}
                onClick={() => (filtersEqual(filter, { kind: 'tag', name: t.name }) ? onFilterChange({ kind: 'all' }) : onFilterChange({ kind: 'tag', name: t.name }))}
                onDoubleClick={() => {
                  if (confirm(`Delete tag "${t.name}"? It will be removed from every book.`)) onDeleteTag(t.id);
                }}
                title="Double-click to delete"
              >
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
