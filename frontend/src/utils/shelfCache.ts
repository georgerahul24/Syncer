// The shelf as last fetched, so launching the app paints the library at once
// from this device's copy instead of waiting on the network, then refreshes
// underneath. Per-user so switching accounts never flashes someone else's.
function shelfKey(userId: string | undefined, kind: 'books' | 'folders' | 'tags') {
  return `syncer:shelf:${userId ?? 'anon'}:${kind}`;
}

export function readShelf<T>(userId: string | undefined, kind: 'books' | 'folders' | 'tags'): T | null {
  try {
    const raw = localStorage.getItem(shelfKey(userId, kind));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeShelf(userId: string | undefined, kind: 'books' | 'folders' | 'tags', value: unknown) {
  try {
    localStorage.setItem(shelfKey(userId, kind), JSON.stringify(value));
  } catch {
    // best-effort only
  }
}
