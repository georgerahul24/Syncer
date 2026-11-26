/** Runs `fn` when the browser is idle (within `timeoutMs`), or after `fallbackMs` where idle callbacks don't exist (Safari). */
export function runWhenIdle(fn: () => void, timeoutMs: number, fallbackMs = 0): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: timeoutMs });
  else setTimeout(fn, fallbackMs);
}
