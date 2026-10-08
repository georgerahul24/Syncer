import { useEffect } from 'react';

/**
 * Keeps the screen awake while a book is open.
 *
 * Reading is the one activity where the OS's idle timer is actively wrong:
 * you can spend two minutes on a page without touching the screen, and the
 * display dims and locks mid-paragraph. Every dedicated reading app holds a
 * wake lock for exactly this reason.
 *
 * Best-effort by design — the API is missing on some browsers, and a request
 * is rejected outright when the page isn't visible or the device is on low
 * battery. All of those are fine: the failure mode is just the screen
 * behaving as it did before.
 */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const wakeLockApi = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock;
    if (!wakeLockApi) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    async function acquire() {
      try {
        const next = await wakeLockApi!.request('screen');
        if (released) {
          next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // Denied (backgrounded, battery saver) — nothing to do.
      }
    }

    // The OS drops the lock whenever the page is backgrounded, and does NOT
    // restore it on return, so without re-acquiring here the lock silently
    // stops working the first time the reader switches apps and comes back.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !sentinel) acquire();
    }

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}

interface WakeLockSentinel {
  release: () => Promise<void>;
}
