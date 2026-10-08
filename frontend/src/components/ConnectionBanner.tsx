import { useEffect, useState } from 'react';
import { getApiBase, isNativeApp, subscribeConnectionKind, type ConnectionKind } from '../services/serverConfig';
import styles from './ConnectionBanner.module.css';

const LABEL: Record<ConnectionKind, string> = {
  local: 'Connected: home network',
  remote: 'Connected: remote (Tailscale)',
  offline: 'Not connected — showing offline books only',
};

/**
 * Only meaningful for the native app (the web build always talks same-origin
 * and has nothing to resolve). Kicks off resolution itself via getApiBase()
 * so this renders correctly even when mounted before anything else has
 * triggered a request (e.g. on the login screen, where a failed sign-in
 * otherwise gives no clue whether it's a bad password or a bad connection).
 */
export default function ConnectionBanner() {
  const [kind, setKind] = useState<ConnectionKind | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    getApiBase();
    return subscribeConnectionKind(setKind);
  }, []);

  if (!isNativeApp() || kind === null) return null;

  return (
    <div className={`${styles.banner} ${styles[kind]}`} role="status">
      {LABEL[kind]}
    </div>
  );
}
