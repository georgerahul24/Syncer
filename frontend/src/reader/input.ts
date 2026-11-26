// Small input helpers shared by the paginated readers.

/** True while focus is in a text field, where arrow keys must type, not turn pages. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/** 1 for a next-page key, -1 for a previous-page key, 0 for anything else. */
export function pageKeyDirection(key: string): 1 | -1 | 0 {
  if (key === 'ArrowRight' || key === 'PageDown') return 1;
  if (key === 'ArrowLeft' || key === 'PageUp') return -1;
  return 0;
}

const SWIPE_THRESHOLD_PX = 40;

/** A horizontal swipe of `dx` pixels: left turns forward (1), right turns back (-1). */
export function swipeDirection(dx: number): 1 | -1 | 0 {
  if (dx <= -SWIPE_THRESHOLD_PX) return 1;
  if (dx >= SWIPE_THRESHOLD_PX) return -1;
  return 0;
}
