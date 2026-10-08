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

// How often the running "actually read" estimate is updated. Short enough
// that a single sample can't straddle both a jump and a lot of real
// reading (which would let the jump ride along under the real reading's
// cap), long enough not to be pointless overhead.
const SAMPLE_INTERVAL_MS = 5000;
// Generous ceiling on reading speed, expressed as fraction-of-whole-book
// per second of active time — a TOC jump, a search/annotation jump, or a
// remote-sync update from another device can move `progress` by a large
// step in zero real time, and previously that whole step got counted as
// "pages read" right along with genuine reading (see the file-header note
// below and backend/src/analytics/routes.ts). Picked against a ~300-page
// book (this file's rough equivalent of the backend's
// DEFAULT_PAGE_COUNT_ESTIMATE, since progress here is a bookwide fraction
// regardless of format): ~1 page every 2.2 seconds, comfortably faster
// than normal reading or fast skimming, so real reading is never clipped —
// only an instant jump is.
const MAX_READ_FRACTION_PER_SECOND = 0.0015;

/**
 * Tracks active (tab-visible) reading time for the current book and
 * periodically reports it to the backend (see backend/src/analytics/routes.ts).
 * Time while the tab is hidden/backgrounded is deliberately not counted —
 * see the Page Visibility handling below — so "time read" reflects actual
 * attention, not just an open tab.
 *
 * Two separate things get tracked, on purpose:
 *  - startProgress/endProgress: where you actually were at the start/end of
 *    the window. Real positions, unfiltered — a jump is still where you
 *    ended up, and the dashboard's "furthest point reached" needs that.
 *  - a running "read" estimate: the sum of forward progress sampled every
 *    SAMPLE_INTERVAL_MS, each sample capped to a plausible reading speed.
 *    A TOC jump, a search/annotation jump, or a remote-sync update from
 *    another device can move `progress` by a large step in no real time at
 *    all; without this, that whole step got counted as pages read right
 *    alongside genuine reading (jump to skim the end of the book, land back
 *    in your actual chapter, and the dashboard credits you for everything
 *    in between). Capping each sample rather than the whole window means
 *    genuine reading before/after a jump still counts in full — only the
 *    jump itself is discarded.
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
    // Baseline for the per-sample cap: the progress and cumulative active
    // seconds as of the last sample, so each sample's cap scales with how
    // much active time actually elapsed since it (not wall-clock time,
    // which would keep advancing while the tab is backgrounded).
    const lastSampleProgressRef = { current: null as number | null };
    const lastSampleActiveSecondsRef = { current: 0 };
    const readEstimateRef = { current: 0 };

    const settleTimer = setTimeout(() => {
      startProgressRef.current = progressRef.current;
      lastSampleProgressRef.current = progressRef.current;
      lastSampleActiveSecondsRef.current = activeSecondsRef.current;
    }, POSITION_SETTLE_MS);

    function tick() {
      if (lastTickRef.current != null) {
        activeSecondsRef.current += (Date.now() - lastTickRef.current) / 1000;
        lastTickRef.current = Date.now();
      }
    }

    function sample() {
      tick();
      if (lastSampleProgressRef.current == null) return; // hasn't settled yet
      const elapsedActive = activeSecondsRef.current - lastSampleActiveSecondsRef.current;
      const rawDelta = progressRef.current - lastSampleProgressRef.current;
      if (rawDelta > 0 && elapsedActive > 0) {
        readEstimateRef.current += Math.min(rawDelta, MAX_READ_FRACTION_PER_SECOND * elapsedActive);
      }
      // A backward move (re-reading, or a chapter-crossing correction) is
      // never subtracted — it just isn't added — and either way this
      // becomes the new baseline, so a jump's excess is dropped rather than
      // "made up" once real reading resumes from wherever it landed.
      lastSampleProgressRef.current = progressRef.current;
      lastSampleActiveSecondsRef.current = activeSecondsRef.current;
    }

    function flush() {
      sample();
      const duration = Math.round(activeSecondsRef.current);
      if (duration >= MIN_FLUSH_SECONDS && startProgressRef.current != null) {
        analytics.logSession(bookId, {
          durationSeconds: duration,
          startProgress: startProgressRef.current,
          endProgress: progressRef.current,
          readProgressDelta: readEstimateRef.current,
        });
      }
      startProgressRef.current = progressRef.current;
      activeSecondsRef.current = 0;
      lastSampleProgressRef.current = progressRef.current;
      lastSampleActiveSecondsRef.current = 0;
      readEstimateRef.current = 0;
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        lastTickRef.current = Date.now();
      } else {
        sample();
        lastTickRef.current = null;
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    const sampleInterval = setInterval(sample, SAMPLE_INTERVAL_MS);
    const flushInterval = setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      clearTimeout(settleTimer);
      flush();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      clearInterval(sampleInterval);
      clearInterval(flushInterval);
    };
  }, [bookId]);
}
