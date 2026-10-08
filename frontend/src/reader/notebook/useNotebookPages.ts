import { useCallback, useEffect, useState } from 'react';
import type { InkStroke, NotebookPage } from '../../types';
import { notebookPages as notebookPagesApi } from '../../services/api';
import { enqueue, isNetworkError } from '../../services/offlineQueue';
import type { NotebookRemoteEvent } from '../sync/useReaderSync';

let tmpCounter = 0;

export type NotebookLocation = { afterPage: number } | { overlayPage: number };

/**
 * Same optimistic create/update/delete + offline-queue pattern as
 * useAnnotations. `remoteEvent` is the live push from another open session
 * (see useReaderSync) — this is what makes a stylus stroke drawn on one
 * device show up on another already-open one as it's drawn, instead of
 * only on that session's next reload.
 */
export function useNotebookPages(bookId: string, remoteEvent?: NotebookRemoteEvent | null) {
  const [pages, setPages] = useState<NotebookPage[]>([]);

  useEffect(() => {
    notebookPagesApi
      .list(bookId)
      .then(setPages)
      .catch(() => {});
  }, [bookId]);

  useEffect(() => {
    if (!remoteEvent) return;
    if (remoteEvent.kind === 'upsert' && remoteEvent.page) {
      const incoming = remoteEvent.page;
      setPages((prev) => {
        const local = prev.find((p) => p.id === incoming.id);
        // A broadcast can be this same session's own save echoing back
        // after the user has already drawn a further stroke locally (fired
        // optimistically, still in flight) — updatedAt tells us which is
        // newer, so a slow echo of an older save can't stomp a newer local
        // stroke that just hasn't reached the server yet.
        if (local && local.updatedAt > incoming.updatedAt) return prev;
        return local ? prev.map((p) => (p.id === incoming.id ? incoming : p)) : [...prev, incoming];
      });
    } else if (remoteEvent.kind === 'delete' && remoteEvent.pageId) {
      const id = remoteEvent.pageId;
      setPages((prev) => prev.filter((p) => p.id !== id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEvent]);

  const create = useCallback(
    (location: NotebookLocation, initial?: { text?: string; strokes?: InkStroke[] }): NotebookPage => {
      const now = new Date().toISOString();
      const tempId = `tmp-${++tmpCounter}`;
      const optimistic: NotebookPage = {
        id: tempId,
        bookId,
        locationType: 'afterPage' in location ? 'pdf-page' : 'pdf-page-overlay',
        location: 'afterPage' in location ? { afterPage: location.afterPage } : { page: location.overlayPage },
        text: initial?.text ?? '',
        strokes: initial?.strokes ?? [],
        createdAt: now,
        updatedAt: now,
      };
      setPages((prev) => [...prev, optimistic]);

      notebookPagesApi
        .create(bookId, location, initial)
        .then((real) => {
          setPages((prev) => {
            // The user can keep typing/drawing on a page whose create
            // request is still in flight — `real` only reflects `initial`
            // (what we knew at the moment we called create), so if local
            // state has since moved further, that's real content that
            // would otherwise be silently discarded the instant we swap
            // the temp row out for the server's response. Push it instead.
            const local = prev.find((p) => p.id === tempId);
            const diverged = local && (local.text !== real.text || local.strokes.length !== real.strokes.length);
            if (diverged && local) {
              notebookPagesApi.update(real.id, { text: local.text, strokes: local.strokes }).catch(() => {});
              return prev.map((p) => (p.id === tempId ? { ...real, text: local.text, strokes: local.strokes } : p));
            }
            return prev.map((p) => (p.id === tempId ? real : p));
          });
        })
        .catch(() => setPages((prev) => prev.filter((p) => p.id !== tempId)));

      return optimistic;
    },
    [bookId]
  );

  const update = useCallback((id: string, patch: { text?: string; strokes?: InkStroke[] }): Promise<void> => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)));
    // A tmp- id's own pending create() carries this same local state
    // forward (see the reconciliation above) once it resolves, so there's
    // no separate network call to make — and nothing further to await.
    if (id.startsWith('tmp-')) return Promise.resolve();
    const run = () => notebookPagesApi.update(id, patch).then(() => {});
    return run().catch((err) => {
      if (isNetworkError(err)) enqueue(run);
      throw err;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (id.startsWith('tmp-')) return;
    const run = () => notebookPagesApi.remove(id);
    run().catch((err) => {
      if (isNetworkError(err)) enqueue(run);
    });
  }, []);

  return { pages, create, update, remove };
}
