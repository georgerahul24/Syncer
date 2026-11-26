/**
 * Applies an upsert pushed from another session for this book. Our own copy
 * wins when it is newer: a broadcast can be this session's own save echoing
 * back after the user already made a further edit locally (fired
 * optimistically, still in flight), and a slow echo of an older save must
 * not overwrite it.
 */
export function mergeRemoteUpsert<T extends { id: string; updatedAt: string }>(prev: T[], incoming: T): T[] {
  const local = prev.find((item) => item.id === incoming.id);
  if (local && local.updatedAt > incoming.updatedAt) return prev;
  return local ? prev.map((item) => (item.id === incoming.id ? incoming : item)) : [...prev, incoming];
}
