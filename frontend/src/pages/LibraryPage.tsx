import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { auth as authApi, books as booksApi, folders as foldersApi, tags as tagsApi, ApiError } from '../services/api';
import type { Book, Folder, Tag } from '../types';
import BookCard from '../components/BookCard';
import LibrarySidebar, { type LibraryFilter } from '../components/LibrarySidebar';
import OrganizeBookDialog from '../components/OrganizeBookDialog';
import BookAnalyticsDialog from '../components/BookAnalyticsDialog';
import LibrarySearchBar from '../components/LibrarySearchBar';
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
  const [analyticsBook, setAnalyticsBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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

  // A failed share-target upload (see backend/src/share/routes.ts) redirects
  // here with ?error=..., since that's a real page navigation, not a fetch()
  // call we could otherwise catch a rejection from.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareError = params.get('error');
    if (shareError) {
      setError(shareError);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

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

  const uploadFile = async (file: File) => {
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

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadFile(file);
  };

  // Dropping a file anywhere on the library uploads it; dropping a book
  // card (see BookCard's BOOK_DRAG_MIME) is a different drag entirely and
  // must not trigger this — checked via dataTransfer.types, since the
  // actual book-id payload isn't readable until the 'drop' event fires.
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const onPageDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };
  const onPageDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  };
  const onPageDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  };
  const onPageDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const onDropBookOnFolder = (bookId: string, folderId: string | null) => {
    const book = books?.find((b) => b.id === bookId);
    if (book) setBookFolder(book, folderId);
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
    <div
      className={styles.page}
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {isDraggingFile && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayCard}>Drop to upload</div>
        </div>
      )}
      <div className={styles.topbar}>
        <div className={styles.brand}>Syncer</div>
        <LibrarySearchBar />
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
                <button type="button" className={styles.logoutButton} onClick={() => navigate('/dashboard')}>
                  Reading dashboard
                </button>
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
              onDropBook={onDropBookOnFolder}
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
                          folders={folders}
                          subtitle={`${Math.round(b.progress!.progress * 100)}% · ${formatRelativeTime(b.progress!.updatedAt)}`}
                          onOpen={openBook}
                          onDelete={deleteBook}
                          onOrganize={setOrganizingBook}
                          onSetFolder={setBookFolder}
                          onShowAnalytics={setAnalyticsBook}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Recently Added</h2>
                  <div className={styles.row}>
                    {recentlyAdded.map((b) => (
                      <BookCard
                        key={b.id}
                        book={b}
                        folders={folders}
                        onOpen={openBook}
                        onDelete={deleteBook}
                        onOrganize={setOrganizingBook}
                        onSetFolder={setBookFolder}
                          onShowAnalytics={setAnalyticsBook}
                      />
                    ))}
                  </div>
                </section>

                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>All Books</h2>
                  <div className={styles.grid}>
                    {allBooks.map((b) => (
                      <BookCard
                        key={b.id}
                        book={b}
                        folders={folders}
                        onOpen={openBook}
                        onDelete={deleteBook}
                        onOrganize={setOrganizingBook}
                        onSetFolder={setBookFolder}
                          onShowAnalytics={setAnalyticsBook}
                      />
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
                      <BookCard
                        key={b.id}
                        book={b}
                        folders={folders}
                        onOpen={openBook}
                        onDelete={deleteBook}
                        onOrganize={setOrganizingBook}
                        onSetFolder={setBookFolder}
                          onShowAnalytics={setAnalyticsBook}
                      />
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

      {analyticsBook && <BookAnalyticsDialog book={analyticsBook} onClose={() => setAnalyticsBook(null)} />}
    </div>
  );
}
