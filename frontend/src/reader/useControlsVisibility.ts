import { useCallback, useEffect, useRef, useState } from 'react';

const HIDE_AFTER_MS = 3000;

/**
 * Shared "reader chrome" behavior (section 33): controls are visible on
 * load/activity and fade out after a few seconds of inactivity. Mouse
 * movement, taps, and key presses all count as activity. Never used to
 * hide sync status permanently — callers keep a persistent, subtle status
 * indicator outside whatever this hook controls.
 */
export function useControlsVisibility() {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    show();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show]);

  return { visible, onActivity: show };
}
