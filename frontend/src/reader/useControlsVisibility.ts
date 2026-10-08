import { useCallback, useEffect, useRef, useState } from 'react';

const HIDE_AFTER_MS = 5000;

/**
 * Shared "reader chrome" behavior: the top bar and each reader's progress
 * row stay hidden while reading, and are brought up deliberately by tapping
 * the small handle at the top of the screen (see ReaderChromeHandle), then
 * fall away again after a few idle seconds.
 *
 * The important distinction is between REVEALING and KEEPING ALIVE:
 *
 *   - `reveal` is the only thing that opens the chrome, and only the handle
 *     calls it. Reading a book is a continuous stream of taps, scrolls and
 *     page turns, so anything that opens the chrome on generic activity
 *     means the bar is on screen essentially the whole time you're reading —
 *     which is exactly what this replaces.
 *   - `keepAlive` extends the timer but never opens anything. Interacting
 *     with the chrome you just opened shouldn't have it vanish mid-tap, but
 *     that same interaction must not summon it back once it's gone.
 *
 * Sync status is never permanently hidden by any of this — the handle itself
 * carries it (again, ReaderChromeHandle), so it stays on screen even when
 * every other piece of chrome is gone.
 */
export function useControlsVisibility() {
  const [visible, setVisible] = useState(false);
  // Mirrors `visible` for keepAlive to read without taking a dependency on
  // it — otherwise every reveal would hand readers a fresh onActivity
  // identity, re-running the effects that attach their scroll/touch
  // listeners on every single show/hide cycle.
  const visibleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      visibleRef.current = false;
      setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  const reveal = useCallback(() => {
    visibleRef.current = true;
    setVisible(true);
    arm();
  }, [arm]);

  const keepAlive = useCallback(() => {
    if (visibleRef.current) arm();
  }, [arm]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    visibleRef.current = false;
    setVisible(false);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { visible, reveal, keepAlive, hide, onActivity: keepAlive };
}
