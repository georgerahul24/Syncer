import { useCallback, useEffect, useState } from 'react';
import type { Annotation, AnnotationColor, NewAnnotationInput } from '../../types';
import { annotations as annotationsApi } from '../../services/api';
import { enqueue, isNetworkError } from '../../services/offlineQueue';
import type { AnnotationRemoteEvent } from '../sync/useReaderSync';

let tmpCounter = 0;

/**
 * Loads a book's annotations and provides optimistic create/update/delete.
 * A mutation that fails due to a network error (not a server rejection) is
 * queued and retried automatically once the browser is back online — see
 * services/offlineQueue.ts — so highlighting/note-taking keeps working
 * offline (product spec section 22).
 *
 * `remoteEvent` is the live push from another open session for this same
 * book (see useReaderSync's notebookEvent/annotationEvent) — a highlight or
 * note made there is applied here as it happens, not just on next reload.
 * Applying our own edits' echo back is harmless: same id, same fields, no
 * visible change.
 */
export function useAnnotations(bookId: string, remoteEvent?: AnnotationRemoteEvent | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!remoteEvent) return;
    if (remoteEvent.kind === 'upsert' && remoteEvent.annotation) {
      const incoming = remoteEvent.annotation;
      setAnnotations((prev) => {
        const local = prev.find((a) => a.id === incoming.id);
        // See the matching comment in useNotebookPages.ts: guards against a
        // slow echo of this session's own older save overwriting a newer
        // local edit still in flight.
        if (local && local.updatedAt > incoming.updatedAt) return prev;
        return local ? prev.map((a) => (a.id === incoming.id ? incoming : a)) : [...prev, incoming];
      });
    } else if (remoteEvent.kind === 'delete' && remoteEvent.annotationId) {
      const id = remoteEvent.annotationId;
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEvent]);

  useEffect(() => {
    setLoaded(false);
    annotationsApi
      .list(bookId)
      .then((list) => {
        setAnnotations(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [bookId]);

  const create = useCallback(
    (input: NewAnnotationInput) => {
      const now = new Date().toISOString();
      const tempId = `tmp-${++tmpCounter}`;
      const optimistic: Annotation = {
        id: tempId,
        bookId,
        type: input.type,
        color: input.color,
        locationType: input.locationType,
        location: input.location,
        selectedText: input.selectedText ?? null,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      };
      setAnnotations((prev) => [...prev, optimistic]);

      const run = () =>
        annotationsApi.create(bookId, input).then((real) => {
          setAnnotations((prev) => prev.map((a) => (a.id === tempId ? real : a)));
        });

      run().catch((err) => {
        if (isNetworkError(err)) enqueue(run);
        else setAnnotations((prev) => prev.filter((a) => a.id !== tempId));
      });

      return optimistic;
    },
    [bookId]
  );

  const update = useCallback((id: string, patch: { color?: AnnotationColor; note?: string | null }) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)));
    const run = () =>
      annotationsApi.update(id, patch).then((real) => {
        setAnnotations((prev) => prev.map((a) => (a.id === id ? real : a)));
      });
    run().catch((err) => {
      if (isNetworkError(err)) enqueue(run);
    });
  }, []);

  const remove = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    const run = () => annotationsApi.remove(id);
    run().catch((err) => {
      if (isNetworkError(err)) enqueue(run);
    });
  }, []);

  return { annotations, loaded, create, update, remove };
}
