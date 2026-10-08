import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { useReaderSettings } from '../hooks/useReaderSettings';
import { useReaderSync } from '../reader/sync/useReaderSync';
import { useControlsVisibility } from '../reader/useControlsVisibility';
import { useFullscreen } from '../hooks/useFullscreen';
import { useScreenWakeLock } from '../hooks/useScreenWakeLock';
import { useAnnotations } from '../reader/annotations/useAnnotations';
import { books as booksApi, ApiError } from '../services/api';
import type { Book, TocItem } from '../types';
import { cacheBookMeta, describeDownloadFailure, downloadBookForOffline, getCachedBookMeta, isBookOffline, removeBookOffline } from '../utils/offlineBooks';
import { useBookSource } from '../reader/useBookSource';
import { readShelf } from '../utils/shelfCache';
import { forgetPdfThumbnail } from '../reader/pdf/PdfCoverThumbnail';
import ReaderTopBar from '../reader/ReaderTopBar';
import ReaderChromeHandle from '../reader/ReaderChromeHandle';
import ReaderSettingsMenu from '../reader/ReaderSettingsMenu';
import TocPanel from '../reader/TocPanel';
import AnnotationPanel from '../reader/annotations/AnnotationPanel';
import PdfReader from '../reader/pdf/PdfReader';
import EpubReader from '../reader/epub/EpubReader';
import TextReader from '../reader/text/TextReader';
import styles from './ReaderPage.module.css';

export default function ReaderPage({ bookId }: { bookId: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  // Opened before on this device: start from what we saw last time, so the
  // download/open can begin at once instead of after a server round trip.
  // The fresh copy below replaces it when it arrives.
  const [book, setBook] = useState<Book | null>(
    () => getCachedBookMeta(bookId) ?? readShelf<Book[]>(user?.id, 'books')?.find((b) => b.id === bookId) ?? null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);

  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [outlineTarget, setOutlineTarget] = useState<TocItem | null>(null);
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null);
  const [offlineState, setOfflineState] = useState<{ kind: 'none' | 'available' } | { kind: 'downloading'; fraction: number }>(() => ({
    kind: isBookOffline(bookId) ? 'available' : 'none',
  }));

  const { settings, update: updateSettings } = useReaderSettings();
  const { visible: controlsVisible, reveal: revealControls, onActivity } = useControlsVisibility();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const sync = useReaderSync(bookId, user?.syncEnabled ?? true, book?.syncEnabled ?? true);
  const { annotations, create, update: updateAnnotation, remove: removeAnnotation } = useAnnotations(bookId, sync.annotationEvent);
  // Every book is read from a complete local copy, downloading it first if
  // needed — see reader/useBookSource.ts and utils/offlineBooks.ts. No reader
  // is mounted until that's done, so none of them ever deal with a partially
  // available file.
  const source = useBookSource(book);
  // Only once a book is actually open — not while the library or a download
  // screen is up.
  useScreenWakeLock(source.status === 'ready');

  useEffect(() => {
    booksApi
      .get(bookId)
      .then((b) => {
        setBook(b);
        cacheBookMeta(b);
      })
      .catch((err) => {
        // Unreachable but opened before: keep reading the cached copy. A real
        // 4xx/5xx from the server (deleted book, etc.) still surfaces.
        if (err instanceof ApiError) setLoadError(err.message);
        else if (!getCachedBookMeta(bookId) && !readShelf<Book[]>(user?.id, 'books')?.some((b) => b.id === bookId)) {
          setLoadError("Can't reach your Syncer server from this network, and this book isn't on this device yet.");
        }
      });
  }, [bookId]);

  // A library-search result jump (see components/LibrarySearchBar.tsx)
  // arrives as a query param on a fresh navigation rather than an
  // in-reader TOC click, but feeds the exact same outlineTarget mechanism
  // once the reader is open. Consumed once, then stripped from the URL so
  // it doesn't re-fire on a later re-render or back/forward navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jumpPage = params.get('jumpPage');
    const jumpHref = params.get('jumpHref');
    if (jumpPage) setOutlineTarget({ label: '', page: Number(jumpPage) });
    else if (jumpHref) setOutlineTarget({ label: '', href: jumpHref });
    if (jumpPage || jumpHref) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  useEffect(() => {
    const handler = () => sync.flushOnExit();
    // 'pagehide' alone isn't reliable on mobile: an installed PWA that gets
    // backgrounded (home button, app switch) and then killed by the OS while
    // still in the background can skip it entirely, silently dropping the
    // last bit of reading progress (it never reaches the server, so another
    // device/tab keeps showing the older position). 'visibilitychange' fires
    // on backgrounding itself, before any OS process kill can race it.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handler();
    };
    window.addEventListener('pagehide', handler);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handler);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sync.flushOnExit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const toggleBookSync = useCallback(
    async (enabled: boolean) => {
      if (!book) return;
      const res = await booksApi.setSync(book.id, enabled);
      setBook({ ...book, syncEnabled: res.syncEnabled });
    },
    [book]
  );

  // Opening a book downloads it, so it becomes "available offline" without
  // the user ever choosing that explicitly — reflect it in the top bar so the
  // action there reads "Remove download" rather than offering a download
  // that already happened.
  useEffect(() => {
    if (source.status === 'ready' && isBookOffline(bookId)) setOfflineState({ kind: 'available' });
  }, [source.status, bookId]);

  // Chrome starts hidden and is only summoned by the handle (see
  // useControlsVisibility), so show it once as the book opens — otherwise
  // the first thing a reader meets is a bare page with no visible way back,
  // and the handle is subtle by design. It times out on its own.
  useEffect(() => {
    if (source.status === 'ready') revealControls();
  }, [source.status, revealControls]);

  const toggleOffline = useCallback(async () => {
    if (!book) return;
    if (offlineState.kind === 'available') {
      await removeBookOffline(book.id);
      forgetPdfThumbnail(book.id);
      setOfflineState({ kind: 'none' });
      return;
    }
    if (offlineState.kind === 'downloading') return;
    setOfflineState({ kind: 'downloading', fraction: 0 });
    try {
      await downloadBookForOffline(book, (fraction) => setOfflineState({ kind: 'downloading', fraction }));
      setOfflineState({ kind: 'available' });
    } catch (err) {
      console.error('offline download failed', err);
      setOfflineState({ kind: 'none' });
      setReaderError(describeDownloadFailure(err));
    }
  }, [book, offlineState]);

  const goBack = () => navigate('/');

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.centered}>
          <p>{loadError}</p>
          <button type="button" onClick={goBack}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  if (!book) return <div className={styles.page} />;

  // Hold the reader closed until the server's position has arrived too, so
  // the book opens where it was last read on ANY device rather than opening
  // at this device's cached spot and jumping a moment later. Bounded by
  // POSITION_WAIT_MS in useReaderSync, so offline still opens.
  if (source.status === 'ready' && !sync.positionReady) {
    return (
      <div className={styles.page}>
        <div className={styles.centered}>
          <p className={styles.downloadTitle}>{book.title}</p>
          <p>Opening book…</p>
        </div>
      </div>
    );
  }

  if (source.status !== 'ready') {
    const pct = source.status === 'downloading' && source.fraction !== null ? Math.round(source.fraction * 100) : null;
    return (
      <div className={styles.page}>
        <div className={styles.centered}>
          {source.status === 'error' ? (
            <>
              <p>{source.message}</p>
              <button type="button" onClick={source.retry}>
                Try again
              </button>
              <button type="button" onClick={goBack}>
                Back to library
              </button>
            </>
          ) : (
            <>
              <p className={styles.downloadTitle}>{book.title}</p>
              <p>{source.status === 'checking' ? 'Opening book…' : 'Downloading book…'}</p>
              <div className={styles.downloadTrack}>
                <div
                  className={`${styles.downloadFill} ${pct === null ? styles.downloadFillIndeterminate : ''}`}
                  style={pct === null ? undefined : { width: `${pct}%` }}
                />
              </div>
              {pct !== null && <p className={styles.downloadPct}>{pct}%</p>}
              {/* A big book on a slow link can sit here for a while, and this
                  screen replaces the reader chrome (top bar included) — so
                  without this there is no way back out of it short of the
                  hardware back gesture, which on the native app closes the
                  app rather than returning to the library. */}
              <button type="button" onClick={goBack}>
                Back to library
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const ReaderComponent = book.format === 'pdf' ? PdfReader : book.format === 'epub' ? EpubReader : TextReader;

  return (
    // These only KEEP the chrome alive (see useControlsVisibility) — they
    // deliberately can't summon it. Reading is a constant stream of taps and
    // scrolls, so revealing on generic activity is what kept the top bar on
    // screen the whole time you were reading.
    <div className={styles.page} onMouseMove={onActivity} onClick={onActivity} onKeyDown={onActivity} onTouchStart={onActivity}>
      <ReaderChromeHandle
        visible={!controlsVisible}
        onReveal={revealControls}
        connectionState={sync.connectionState}
        effectiveSyncEnabled={sync.effectiveSyncEnabled}
      />
      <ReaderTopBar
        visible={controlsVisible}
        book={book}
        connectionState={sync.connectionState}
        userSyncEnabled={user?.syncEnabled ?? true}
        bookSyncEnabled={book.syncEnabled}
        sessionSyncEnabled={sync.sessionSyncEnabled}
        onToggleSessionSync={sync.setSessionSync}
        onToggleBookSync={toggleBookSync}
        onBack={goBack}
        onOpenToc={() => setTocOpen((v) => !v)}
        onOpenSearch={() => setSearchOpen((v) => !v)}
        onOpenAnnotations={() => setAnnotationsOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen((v) => !v)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        offlineState={offlineState}
        onToggleOffline={toggleOffline}
      />

      <div className={styles.content}>
        <ReaderComponent
          book={book}
          fileUrl={source.url}
          settings={settings}
          annotations={annotations}
          initialPosition={sync.initialPosition}
          remoteUpdate={sync.remoteUpdate}
          notebookEvent={sync.notebookEvent}
          onLocalPositionChange={sync.publishLocalPosition}
          onCreateAnnotation={create}
          onOutlineLoaded={setToc}
          outlineTarget={outlineTarget}
          onOutlineTargetHandled={() => setOutlineTarget(null)}
          focusAnnotationId={focusAnnotationId}
          onFocusHandled={() => setFocusAnnotationId(null)}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          controlsVisible={controlsVisible}
          onActivity={onActivity}
          onError={setReaderError}
        />
      </div>

      {readerError && (
        <div className={styles.errorBanner} role="alert">
          {readerError}
        </div>
      )}

      <TocPanel
        open={tocOpen}
        toc={toc}
        onClose={() => setTocOpen(false)}
        onSelect={(item) => {
          setOutlineTarget(item);
          setTocOpen(false);
        }}
      />

      <AnnotationPanel
        open={annotationsOpen}
        annotations={annotations}
        toc={toc}
        onClose={() => setAnnotationsOpen(false)}
        onNavigate={(a) => {
          setFocusAnnotationId(a.id);
          setAnnotationsOpen(false);
        }}
        onUpdateNote={(id, note) => updateAnnotation(id, { note })}
        onUpdateColor={(id, color) => updateAnnotation(id, { color })}
        onDelete={removeAnnotation}
      />

      <ReaderSettingsMenu open={settingsOpen} format={book.format} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
