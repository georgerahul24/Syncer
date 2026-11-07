import { useEffect, useState } from 'react';
import { isNativeApp } from '../services/serverConfig';
import { checkForUpdate, subscribeUpdate, type UpdateState } from '../services/appUpdate';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 5000;

/** Current update state. Pass `autoCheck` (once, from App) to also run the background checks. */
export function useAppUpdate({ autoCheck = false }: { autoCheck?: boolean } = {}): UpdateState {
  const [state, setState] = useState<UpdateState>({ state: 'idle' });
  useEffect(() => subscribeUpdate(setState), []);

  useEffect(() => {
    if (!autoCheck || !isNativeApp()) return;
    const run = () => void checkForUpdate();
    const first = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const every = setInterval(run, CHECK_EVERY_MS);
    // Phones mostly resume a backgrounded app rather than relaunching it,
    // so coming back to the app counts as a launch too.
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [autoCheck]);

  return state;
}
