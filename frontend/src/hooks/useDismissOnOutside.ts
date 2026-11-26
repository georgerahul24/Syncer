import { useEffect, useRef, type RefObject } from 'react';

/** Calls `onDismiss` on a mouse press or touch anywhere outside `ref`'s element, while `enabled`. */
export function useDismissOnOutside(ref: RefObject<HTMLElement | null>, onDismiss: () => void, enabled = true): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;
    function onPress(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismissRef.current();
    }
    window.addEventListener('mousedown', onPress);
    window.addEventListener('touchstart', onPress, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onPress);
      window.removeEventListener('touchstart', onPress);
    };
  }, [ref, enabled]);
}
