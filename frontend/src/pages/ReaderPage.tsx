import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { useReaderSettings } from '../hooks/useReaderSettings';
import { useReaderSync } from '../reader/sync/useReaderSync';
import { useControlsVisibility } from '../reader/useControlsVisibility';
import { useAnnotations } from '../reader/annotations/useAnnotations';
import { books as booksApi, ApiError } from '../services/api';
import type { Book, TocItem } from '../types';
import ReaderTopBar, { PersistentSyncDot } from '../reader/ReaderTopBar';
import ReaderSettingsMenu from '../reader/ReaderSettingsMenu';
import TocPanel from '../reader/TocPanel';
import AnnotationPanel from '../reader/annotations/AnnotationPanel';
import PdfReader from '../reader/pdf/PdfReader';
import EpubReader from '../reader/epub/EpubReader';
import styles from './ReaderPage.module.css';

export default function ReaderPage({ bookId }: { bookId: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);

  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [outlineTarget, setOutlineTarget] = useState<TocItem | null>(null);
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null);

  const { settings, update: updateSettings } = useReaderSettings();
  const { visible: controlsVisible, onActivity } = useControlsVisibility();
  const { annotations, create, update: updateAnnotation, remove: removeAnnotation } = useAnnotations(bookId);
  const sync = useReaderSync(bookId, user?.syncEnabled ?? true, book?.syncEnabled ?? true);

  useEffect(() => {
    booksApi
      .get(bookId)
      .then(setBook)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'This book could not be opened.'));
  }, [bookId]);

  useEffect(() => {
    const handler = () => sync.flushOnExit();
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
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

  const ReaderComponent = book.format === 'pdf' ? PdfReader : EpubReader;

  return (
    <div className={styles.page} onMouseMove={onActivity} onClick={onActivity} onKeyDown={onActivity} onTouchStart={onActivity}>
      <PersistentSyncDot connectionState={sync.connectionState} effectiveSyncEnabled={sync.effectiveSyncEnabled} />
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
      />

      <div className={styles.content}>
        <ReaderComponent
          book={book}
          settings={settings}
          annotations={annotations}
          initialPosition={sync.initialPosition}
          remoteUpdate={sync.remoteUpdate}
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

      {settingsOpen && (
        <ReaderSettingsMenu format={book.format} settings={settings} onChange={updateSettings} />
      )}
    </div>
  );
}
