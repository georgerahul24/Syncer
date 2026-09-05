// An in-memory retry queue for annotation mutations, so that
// highlighting/note-taking keeps working while offline (section 22 of the
// product spec): a failed request is queued instead of lost, and retried
// once the browser reports it's back online.
//
// This is deliberately NOT persisted to localStorage: the closures that
// perform the retry can't be serialized, and storing just a description
// with no way to replay it would be a false promise of durability. In
// practice this means queued mutations survive going offline/online within
// one page session, but not a hard reload while offline mid-queue — an
// acceptable, documented simplification for a self-hosted reading app.
interface QueuedTask {
  id: string;
  run: () => Promise<void>;
}

let pending: QueuedTask[] = [];
let flushing = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Enqueues a mutation to retry later, and immediately attempts a flush. */
export function enqueue(run: () => Promise<void>): void {
  pending.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, run });
  notify();
  void flush();
}

export function isNetworkError(err: unknown): boolean {
  // fetch() rejects with a plain TypeError for network failures (offline,
  // DNS, connection refused) — a server-returned error response resolves
  // normally and throws our own ApiError instead, which we don't want to queue.
  return err instanceof TypeError;
}

export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    while (pending.length > 0) {
      const task = pending[0];
      try {
        await task.run();
        pending.shift();
      } catch (err) {
        if (isNetworkError(err)) break; // still offline; stop and retry later
        pending.shift(); // a real server rejection — don't retry forever
      }
      notify();
    }
  } finally {
    flushing = false;
  }
}

export function pendingCount(): number {
  return pending.length;
}

window.addEventListener('online', () => void flush());
