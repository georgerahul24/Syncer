import { useCallback, useEffect, useState } from 'react';
import type { InkStroke, NotebookPage } from '../../types';
import { notebookPages as notebookPagesApi } from '../../services/api';
import { enqueue, isNetworkError } from '../../services/offlineQueue';

let tmpCounter = 0;

/** Same optimistic create/update/delete + offline-queue pattern as useAnnotations. */
export function useNotebookPages(bookId: string) {
  const [pages, setPages] = useState<NotebookPage[]>([]);

  useEffect(() => {
    notebookPagesApi
      .list(bookId)
      .then(setPages)
      .catch(() => {});
  }, [bookId]);

  const create = useCallback(
    (afterPage: number) => {
      const now = new Date().toISOString();
      const tempId = `tmp-${++tmpCounter}`;
      const optimistic: NotebookPage = {
        id: tempId,
        bookId,
        locationType: 'pdf-page',
        location: { afterPage },
        text: '',
        strokes: [],
        createdAt: now,
        updatedAt: now,
      };
      setPages((prev) => [...prev, optimistic]);

      notebookPagesApi
        .create(bookId, afterPage)
        .then((real) => setPages((prev) => prev.map((p) => (p.id === tempId ? real : p))))
        .catch(() => setPages((prev) => prev.filter((p) => p.id !== tempId)));

      return optimistic;
    },
    [bookId]
  );

  const update = useCallback((id: string, patch: { text?: string; strokes?: InkStroke[] }) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)));
    if (id.startsWith('tmp-')) return; // optimistic create hasn't resolved yet; its own .then will carry stale data otherwise
    const run = () => notebookPagesApi.update(id, patch).then(() => {});
    run().catch((err) => {
      if (isNetworkError(err)) enqueue(run);
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
