import { useCallback, useEffect, useState } from 'react';

/**
 * Wraps the standard Fullscreen API for the whole viewport (removes browser
 * chrome — address bar, tabs — not just an in-page element), so "maximize
 * reading" means the same thing a video player's fullscreen button does.
 * `isFullscreen` tracks `fullscreenchange` rather than local toggle state
 * alone, since the browser can also exit fullscreen on its own (Esc key)
 * without going through `toggle()`.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return { isFullscreen, toggle };
}
