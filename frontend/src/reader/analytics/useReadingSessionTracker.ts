import { useEffect, useRef } from 'react';
import { analytics } from '../../services/api';

// A "session" here is a bounded reading interval, not necessarily one
// continuous sitting — flushing periodically bounds how much time could be
// lost if the tab crashes/closes uncleanly mid-read, at the cost of a long
// sitting being logged as several rows instead of one. 10 minutes is a
// compromise: frequent enough to not lose much, coarse enough that
// "average session length" in the dashboard still means something.
const FLUSH_INTERVAL_MS = 10 * 60 * 1000;
const MIN_FLUSH_SECONDS = 10;
// Both readers restore a resumed position asynchronously after mount (PDF:
// once the doc + initial position load; EPUB: on the first 'relocated'
// event), which can jump `progress` from 0 straight to wherever the reader
// last left off. If the baseline were captured at raw mount time, that
// instant jump would get misattributed as "pages read" over the next few
// seconds of real time (e.g. "187 pages in 1 minute"). Waiting this long
// before locking in the starting progress lets that resume settle first.
const POSITION_SETTLE_MS = 1500;

/**
 * Tracks active (tab-visible) reading time for the current book and
 * periodically reports it to the backend (see backend/src/analytics/routes.ts).
 * Time while the tab is hidden/backgrounded is deliberately not counted —
 * see the Page Visibility handling below — so "time read" reflects actual
 * attention, not just an open tab.
 *
 * `progress` is read via a ref that's updated on every render but is NOT an
 * effect dependency: the effect should only reset when `bookId` changes,
 * not on every position update (which would happen many times a minute).
 */
export function useReadingSessionTracker(bookId: string, progress: number): void {
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const startProgressRef = { current: null as number | null };
    const activeSecondsRef = { current: 0 };
    const lastTickRef = { current: document.visibilityState === 'visible' ? Date.now() : (null as number | null) };
    const settleTimer = setTimeout(() => {
      startProgressRef.current = progressRef.current;
    }, POSITION_SETTLE_MS);

    function tick() {
      if (lastTickRef.current != null) {
        activeSecondsRef.current += (Date.now() - lastTickRef.current) / 1000;
        lastTickRef.current = Date.now();
      }
    }

    function flush() {
      tick();
      const duration = Math.round(activeSecondsRef.current);
      if (duration >= MIN_FLUSH_SECONDS && startProgressRef.current != null) {
        analytics.logSession(bookId, {
          durationSeconds: duration,
          startProgress: startProgressRef.current,
          endProgress: progressRef.current,
        });
      }
      startProgressRef.current = progressRef.current;
      activeSecondsRef.current = 0;
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        lastTickRef.current = Date.now();
      } else {
        tick();
        lastTickRef.current = null;
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      clearTimeout(settleTimer);
      flush();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      clearInterval(interval);
    };
  }, [bookId]);
}
