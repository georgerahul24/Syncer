import { useEffect, useState } from 'react';
import styles from './InstallHint.module.css';

const DISMISSED_KEY = 'syncer.installHintDismissed';

/**
 * Explains the single most confusing thing about self-hosting this app: over
 * plain HTTP on a LAN address, Chrome on Android replaces "Install" with "Add
 * to Home screen", which makes a bookmark rather than a real PWA — so Syncer
 * never appears in the Android share sheet either. Nothing in the UI would
 * otherwise hint at why, and the browser reports it only in DevTools.
 *
 * Renders nothing on a secure origin (HTTPS, or localhost during development),
 * which is also the case where install already works.
 */
export default function InstallHint() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (window.isSecureContext) return;
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false); // private mode etc. — showing it once is fine
    }
  }, []);

  if (dismissed || window.isSecureContext) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not being able to remember the dismissal isn't worth surfacing.
    }
  };

  return (
    <div className={styles.bar} role="status">
      <span>
        Syncer is being served over <code>http://{window.location.host}</code>, so Chrome will only
        make a home-screen <strong>shortcut</strong> — not a real installed app, and not a share-sheet
        target. Serving over HTTPS fixes both; see “Installing on your phone” in the README.
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
