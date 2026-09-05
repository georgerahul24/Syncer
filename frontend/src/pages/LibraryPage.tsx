import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { auth as authApi, books as booksApi, folders as foldersApi, tags as tagsApi, ApiError } from '../services/api';
import type { Book, Folder, Tag } from '../types';
import BookCard from '../components/BookCard';
import LibrarySidebar, { type LibraryFilter } from '../components/LibrarySidebar';
import OrganizeBookDialog from '../components/OrganizeBookDialog';
import { formatRelativeTime } from '../utils/time';
import styles from './LibraryPage.module.css';

export default function LibraryPage() {
  const { navigate } = useRouter();
  const { user, logout, setUser } = useAuth();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [organizingBook, setOrganizingBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    booksApi
      .list()
      .then(setBooks)
      .catch(() => setError('Could not load your library.'));
  }, []);
  const loadFolders = useCallback(() => {
    foldersApi.list().then(setFolders).catch(() => {});
  }, []);
  const loadTags = useCallback(() => {
    tagsApi.list().then(setTags).catch(() => {});
  }, []);

  useEffect(load, [load]);
  useEffect(loadFolders, [loadFolders]);
  useEffect(loadTags, [loadTags]);

  const openBook = (book: Book) => navigate(`/book/${book.id}`);

  const deleteBook = async (book: Book) => {
    if (!confirm(`Delete "${book.title}"? This can't be undone.`)) return;
    try {
      await booksApi.remove(book.id);
      setBooks((prev) => prev?.filter((b) => b.id !== book.id) ?? null);
    } catch {
      setError('Could not delete this book.');
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadPct(0);
    try {
      const book = await booksApi.upload(file, (fraction) => setUploadPct(fraction));
      setBooks((prev) => (prev ? [book, ...prev] : [book]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploadPct(null);
    }
  };

  const toggleGlobalSync = async () => {
    if (!user) return;
    try {
      const res = await authApi.setSync(!user.syncEnabled);
      setUser({ ...user, syncEnabled: res.syncEnabled });
    } catch {
      setError('Could not update sync preference.');
    }
  };

  const createFolder = async (name: string) => {
    try {
      await foldersApi.create(name);
      loadFolders();
    } catch {
      setError('Could not create folder.');
    }
  };
  const renameFolder = async (id: string, name: string) => {
    try {
      await foldersApi.rename(id, name);
      loadFolders();
    } catch {
      setError('Could not rename folder.');
    }
  };
  const deleteFolder = async (id: string) => {
    try {
      await foldersApi.remove(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setBooks((prev) => prev?.map((b) => (b.folderId === id ? { ...b, folderId: null } : b)) ?? null);
      setFilter((f) => (f.kind === 'folder' && f.id === id ? { kind: 'all' } : f));
    } catch {
      setError('Could not delete folder.');
    }
  };
  const deleteTag = async (id: string) => {
    try {
      await tagsApi.remove(id);
      setTags((prev) => prev.filter((t) => t.id !== id));
      setBooks((prev) => prev?.map((b) => ({ ...b, tags: b.tags.filter((t) => t.id !== id) })) ?? null);
      setFilter((f) => (f.kind === 'tag' && !tags.some((t) => t.id !== id && t.name === f.name) ? { kind: 'all' } : f));
    } catch {
      setError('Could not delete tag.');
    }
  };

  const setBookFolder = async (book: Book, folderId: string | null) => {
    try {
      const res = await booksApi.setFolder(book.id, folderId);
      setBooks((prev) => prev?.map((b) => (b.id === book.id ? { ...b, folderId: res.folderId } : b)) ?? null);
      setOrganizingBook((prev) => (prev && prev.id === book.id ? { ...prev, folderId: res.folderId } : prev));
      loadFolders();
    } catch {
      setError('Could not move book.');
    }
  };
  const addTagToBook = async (book: Book, name: string) => {
    try {
      const tag = await tagsApi.addToBook(book.id, name);
      const merge = (b: Book) => (b.tags.some((t) => t.id === tag.id) ? b.tags : [...b.tags, tag]);
      setBooks((prev) => prev?.map((b) => (b.id === book.id ? { ...b, tags: merge(b) } : b)) ?? null);
      setOrganizingBook((prev) => (prev && prev.id === book.id ? { ...prev, tags: merge(prev) } : prev));
      loadTags();
    } catch {
      setError('Could not add tag.');
    }
  };
  const removeTagFromBook = async (book: Book, tagId: string) => {
    try {
      await tagsApi.removeFromBook(book.id, tagId);
      const strip = (b: Book) => b.tags.filter((t) => t.id !== tagId);
      setBooks((prev) => prev?.map((b) => (b.id === book.id ? { ...b, tags: strip(b) } : b)) ?? null);
      setOrganizingBook((prev) => (prev && prev.id === book.id ? { ...prev, tags: strip(prev) } : prev));
      loadTags();
    } catch {
      setError('Could not remove tag.');
    }
  };

  if (books === null) return null;

  const continueReading = books
    .filter((b) => b.progress && b.progress.progress > 0 && b.progress.progress < 0.98)
    .sort((a, b) => (b.progress!.updatedAt > a.progress!.updatedAt ? 1 : -1))
    .slice(0, 8);
  const recentlyAdded = [...books].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 8);
  const allBooks = [...books].sort((a, b) => a.title.localeCompare(b.title));

  const filteredBooks = books
    .filter((b) => {
      if (filter.kind === 'folder') return b.folderId === filter.id;
      if (filter.kind === 'unfiled') return b.folderId === null;
      if (filter.kind === 'tag') return b.tags.some((t) => t.name === filter.name);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const filterTitle =
    filter.kind === 'folder'
      ? folders.find((f) => f.id === filter.id)?.name ?? 'Folder'
      : filter.kind === 'unfiled'
        ? 'Unfiled'
        : filter.kind === 'tag'
          ? `#${filter.name}`
          : 'All Books';

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.brand}>Syncer</div>
        <div className={styles.topbarRight}>
          {error && <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{error}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,application/pdf,application/epub+zip"
            className="visually-hidden"
            onChange={onFilePicked}
          />
          <button
            type="button"
            className={styles.uploadButton}
            disabled={uploadPct !== null}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadPct !== null ? `Uploading… ${Math.round(uploadPct * 100)}%` : 'Add book'}
          </button>
          <div className={styles.userMenuWrap}>
            <button
              type="button"
              className={styles.avatarButton}
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="Account menu"
            >
              {user?.email.slice(0, 1).toUpperCase()}
            </button>
            {userMenuOpen && (
              <div className={styles.userMenu} onMouseLeave={() => setUserMenuOpen(false)}>
                <div className={styles.userMenuEmail}>{user?.email}</div>
                <div className={styles.syncRow}>
                  <span>Sync reading position</span>
                  <input type="checkbox" checked={!!user?.syncEnabled} onChange={toggleGlobalSync} />
                </div>
                <button type="button" className={styles.logoutButton} onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {books.length === 0 ? (
        <div className={styles.empty}>
          <p>Your library is empty.</p>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Add your first book
          </button>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.sidebarCol}>
            <LibrarySidebar
              folders={folders}
              tags={tags}
              filter={filter}
              onFilterChange={setFilter}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
              onDeleteTag={deleteTag}
            />
          </div>
          <div className={styles.content}>
            {filter.kind === 'all' ? (
              <>
                {continueReading.length > 0 && (
                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Continue Reading</h2>
                    <div className={styles.row}>
                      {continueReading.map((b) => (
                        <BookCard
                          key={b.id}
                          book={b}
                          subtitle={`${Math.round(b.progress!.progress * 100)}% · ${formatRelativeTime(b.progress!.updatedAt)}`}
                          onOpen={openBook}
                          onDelete={deleteBook}
                          onOrganize={setOrganizingBook}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Recently Added</h2>
                  <div className={styles.row}>
                    {recentlyAdded.map((b) => (
                      <BookCard key={b.id} book={b} onOpen={openBook} onDelete={deleteBook} onOrganize={setOrganizingBook} />
                    ))}
                  </div>
                </section>

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>All Books</h2>
                  <div className={styles.grid}>
                    {allBooks.map((b) => (
                      <BookCard key={b.id} book={b} onOpen={openBook} onDelete={deleteBook} onOrganize={setOrganizingBook} />
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>{filterTitle}</h2>
                {filteredBooks.length === 0 ? (
                  <p className={styles.emptyFilter}>No books here yet.</p>
                ) : (
                  <div className={styles.grid}>
                    {filteredBooks.map((b) => (
                      <BookCard key={b.id} book={b} onOpen={openBook} onDelete={deleteBook} onOrganize={setOrganizingBook} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {organizingBook && (
        <OrganizeBookDialog
          book={organizingBook}
          folders={folders}
          onClose={() => setOrganizingBook(null)}
          onSetFolder={(folderId) => setBookFolder(organizingBook, folderId)}
          onAddTag={(name) => addTagToBook(organizingBook, name)}
          onRemoveTag={(tagId) => removeTagFromBook(organizingBook, tagId)}
        />
      )}
    </div>
  );
}
