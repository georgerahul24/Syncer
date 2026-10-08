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
import InstallHint from '../components/InstallHint';
import ConnectionBanner from '../components/ConnectionBanner';
import { describeDownloadFailure, downloadBookForOffline, listOfflineBooks, removeBookOffline } from '../utils/offlineBooks';
import { forgetPdfThumbnail } from '../reader/pdf/PdfCoverThumbnail';
import type { OfflineState } from '../components/BookCard';
import { formatRelativeTime } from '../utils/time';
import { readShelf, writeShelf } from '../utils/shelfCache';
import { forgetResolvedBase, isNativeApp } from '../services/serverConfig';
import { flush as flushOfflineQueue } from '../services/offlineQueue';
import { IconRefresh } from '../reader/icons';
import styles from './LibraryPage.module.css';

// How recently the shelf must have been refreshed for returning to the tab
// to skip re-fetching. Long enough that flicking between apps doesn't hammer
// a relayed connection; short enough that coming back to the shelf after
// reading elsewhere shows the new position.
const AUTO_REFRESH_MIN_GAP_MS = 30_000;

export default function LibraryPage() {
  const { navigate } = useRouter();
  const { user, logout, setUser, expireSession } = useAuth();
  const userId = user?.id;
  const [books, setBooks] = useState<Book[] | null>(() => readShelf<Book[]>(userId, 'books'));
  const [folders, setFolders] = useState<Folder[]>(() => readShelf<Folder[]>(userId, 'folders') ?? []);
  const [tags, setTags] = useState<Tag[]>(() => readShelf<Tag[]>(userId, 'tags') ?? []);
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [organizingBook, setOrganizingBook] = useState<Book | null>(null);
  const [analyticsBook, setAnalyticsBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(() => new Set(listOfflineBooks().map((b) => b.id)));
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `refreshing` for the re-entrancy check, so `refresh` doesn't have
  // to depend on it — a dependency there would give the visibilitychange
  // listener below a new function to re-subscribe with on every refresh.
  const refreshingRef = useRef(false);
  const lastRefreshRef = useRef(Date.now());

  // Read during render so `load` can ask "do we already have a list?"
  // without taking `books` as a dependency — it must stay referentially
  // stable, or the effect below re-runs on every fetch it performs.
  const booksRef = useRef<Book[] | null>(books);
  booksRef.current = books;

  /** Resolves true when the server answered. */
  const load = useCallback(async (): Promise<boolean> => {
    // A first load with nothing cached gets a few quiet retries before it
    // gives up: right after a server restart, or on a flaky link, the first
    // request failing is common and almost always transient. A refresh of
    // a shelf already on screen doesn't retry — the old list stays put.
    const attempts = booksRef.current === null ? 4 : 1;
    let lastErr: unknown;
    let hasShelf = booksRef.current !== null;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
      try {
        setBooks(await booksApi.list());
        setError(null);
        return true;
      } catch (err) {
        lastErr = err;
        if (err instanceof ApiError && err.status === 401) {
          // The session is gone server-side. Sign-in is the only way forward.
          expireSession();
          return false;
        }
        // Meanwhile, show whatever is downloaded on this device.
        if (!hasShelf) {
          const offline = listOfflineBooks();
          if (offline.length > 0) {
            setBooks(offline);
            hasShelf = true;
          }
        }
      }
    }
    if (!hasShelf) {
      setError(
        lastErr instanceof ApiError
          ? 'The server had a problem loading your library. Try again in a moment.'
          : "Can't reach your Syncer server from this network. Your books and progress are safe; it will load once the server is reachable."
      );
    }
    console.error('library load failed', lastErr);
    return false;
  }, [expireSession]);
  const loadFolders = useCallback(() => foldersApi.list().then(setFolders).catch(() => {}), []);
  const loadTags = useCallback(() => tagsApi.list().then(setTags).catch(() => {}), []);

  // Every change to the shelf — a fetch or a local edit — is what the next
  // launch should paint first.
  useEffect(() => {
    if (books) writeShelf(userId, 'books', books);
  }, [books, userId]);
  useEffect(() => writeShelf(userId, 'folders', folders), [folders, userId]);
  useEffect(() => writeShelf(userId, 'tags', tags), [tags, userId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);
  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  /**
   * Re-fetches everything the shelf shows, and re-establishes the things that
   * quietly stop working without ever reporting an error.
   *
   * `silent` is the same work without the spinner or the toast, for the
   * automatic refresh below.
   */
  const refresh = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (!silent) {
        setRefreshing(true);
        setError(null);
      }
      try {
        // The most common reason the native app "stops syncing" is not the
        // server at all: this device resolved a base URL once, at app start,
        // and that answer has since gone stale (walked out of the house, or
        // came home and is still talking to the Tailscale relay). Nothing
        // re-probes on its own, so a manual refresh drops the resolution and
        // lets the requests below pick whichever base is reachable now.
        if (isNativeApp()) forgetResolvedBase();
        // Highlights and notes made while offline sit in an in-memory queue
        // waiting for an 'online' event (see services/offlineQueue.ts). That
        // event never fires when the interface was up the whole time and it
        // was only *our* server that was unreachable — exactly the Tailscale
        // case — so the queue can sit full indefinitely. Drain it here.
        await flushOfflineQueue();
        const [reachable] = await Promise.all([load(), loadFolders(), loadTags()]);
        // Cheap, and the source of truth lives outside React: another tab, or
        // this one before a reload, may have added or removed downloads.
        setOfflineIds(new Set(listOfflineBooks().map((b) => b.id)));
        lastRefreshRef.current = Date.now();
        if (!silent) showToast(reachable ? 'Library up to date' : 'Could not reach the server');
      } finally {
        refreshingRef.current = false;
        if (!silent) setRefreshing(false);
      }
    },
    [load, loadFolders, loadTags, showToast]
  );

  // Coming back to the shelf after time away is the moment its contents are
  // most likely to be stale — a book finished on the phone, one added from
  // another device. The manual button exists because this can't catch
  // everything (it deliberately does nothing on a quick tab flick), not
  // because the app should need to be told to look.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshRef.current < AUTO_REFRESH_MIN_GAP_MS) return;
      void refresh({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

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

  const offlineStateFor = (id: string): OfflineState => {
    if (id in downloading) return { kind: 'downloading', fraction: downloading[id] };
    return { kind: offlineIds.has(id) ? 'available' : 'none' };
  };

  const toggleOffline = async (book: Book) => {
    if (offlineIds.has(book.id)) {
      await removeBookOffline(book.id);
      // The grid thumbnail was rendered from those bytes and is cached for
      // the life of the page — drop it, or the card keeps showing a cover
      // for a book that's no longer on the device.
      forgetPdfThumbnail(book.id);
      setOfflineIds((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
      return;
    }
    if (book.id in downloading) return;
    setDownloading((prev) => ({ ...prev, [book.id]: 0 }));
    try {
      await downloadBookForOffline(book, (fraction) => setDownloading((prev) => ({ ...prev, [book.id]: fraction })));
      forgetPdfThumbnail(book.id);
      setOfflineIds((prev) => new Set(prev).add(book.id));
    } catch (err) {
      console.error('offline download failed', err);
      setError(describeDownloadFailure(err));
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[book.id];
        return next;
      });
    }
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

  // Not `return null`: on the native app the very first load waits on the
  // local-vs-remote reachability probe before the book list request even
  // starts (see services/serverConfig.ts), and rendering nothing through all
  // of that is a blank screen for a second or more with no indication the app
  // is doing anything — a large part of what "Tailscale is slow to show the
  // books" actually looked like.
  if (books === null) {
    return (
      <div className={styles.page}>
        <ConnectionBanner />
        {error ? (
          // Without this the first load failing with nothing downloaded left
          // the page on "Loading your library…" forever: `error` was set, but
          // the only branch that renders it is below this early return, so
          // the one state that most needed a way out had none.
          <div className={styles.loading}>
            <p role="alert">{error}</p>
            <button type="button" className={styles.retryButton} disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? 'Trying…' : 'Try again'}
            </button>
          </div>
        ) : (
          <div className={styles.loading}>Loading your library…</div>
        )}
      </div>
    );
  }

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
      <InstallHint />
      <ConnectionBanner />
      <div className={styles.topbar}>
        <div className={styles.brand}>Syncer</div>
        <LibrarySearchBar />
        <div className={styles.topbarRight}>
          {error && <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{error}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain"
            className="visually-hidden"
            onChange={onFilePicked}
          />
          <button
            type="button"
            className={`${styles.refreshButton} ${refreshing ? styles.refreshButtonBusy : ''}`}
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Refresh library"
            aria-label={refreshing ? 'Refreshing library' : 'Refresh library'}
          >
            <IconRefresh />
          </button>
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
                          offlineState={offlineStateFor(b.id)}
                          onToggleOffline={toggleOffline}
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
                          offlineState={offlineStateFor(b.id)}
                          onToggleOffline={toggleOffline}
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
                          offlineState={offlineStateFor(b.id)}
                          onToggleOffline={toggleOffline}
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
                          offlineState={offlineStateFor(b.id)}
                          onToggleOffline={toggleOffline}
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

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
