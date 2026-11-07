import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../services/serverConfig';

// Every push to main that touches the app publishes a GitHub release
// (.github/workflows/release.yml). Both native apps watch that feed:
//
//   - Desktop uses Tauri's updater: it checks latest.json, downloads the
//     signed bundle, verifies it against the public key in tauri.conf.json,
//     swaps the app in place and relaunches.
//   - Android can't replace a sideloaded app by itself, so it compares its
//     version with the latest release and, on tap, opens the APK's download
//     link — the system installer takes it from there.
const RELEASES_API = 'https://api.github.com/repos/georgerahul24/Syncer/releases/latest';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 5000;
const DISMISSED_KEY = 'syncer:update-dismissed';

export type AppUpdate =
  | { state: 'available'; version: string; install: () => void; dismiss: () => void }
  | { state: 'installing'; version: string; progress: number | null }
  | { state: 'failed'; version: string; message: string; dismiss: () => void };

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** True when version `a` is newer than `b` (plain x.y.z). */
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function wasDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

function rememberDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // best-effort only
  }
}

export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const busyRef = useRef(false);

  const dismiss = useCallback((version: string) => {
    rememberDismissed(version);
    setUpdate(null);
  }, []);

  const checkDesktop = useCallback(async () => {
    const { check } = await import('@tauri-apps/plugin-updater');
    const found = await check();
    if (!found || wasDismissed(found.version)) return;
    const version = found.version;
    const install = async () => {
      setUpdate({ state: 'installing', version, progress: null });
      try {
        let total = 0;
        let received = 0;
        await found.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0;
          else if (event.event === 'Progress') {
            received += event.data.chunkLength;
            setUpdate({ state: 'installing', version, progress: total ? received / total : null });
          }
        });
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch (err) {
        console.error('update failed', err);
        setUpdate({ state: 'failed', version, message: 'The update could not be installed. Try again later.', dismiss: () => dismiss(version) });
      }
    };
    setUpdate({ state: 'available', version, install: () => void install(), dismiss: () => dismiss(version) });
  }, [dismiss]);

  const checkAndroid = useCallback(async () => {
    const [{ getVersion }, res] = await Promise.all([import('@tauri-apps/api/app'), fetch(RELEASES_API)]);
    if (!res.ok) return;
    const release = (await res.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
    const latest = release.tag_name.replace(/^v/, '');
    const apk = release.assets.find((a) => a.name.endsWith('.apk'));
    if (!apk || !isNewer(latest, await getVersion()) || wasDismissed(latest)) return;
    const install = async () => {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(apk.browser_download_url);
      setUpdate(null);
    };
    setUpdate({ state: 'available', version: latest, install: () => void install(), dismiss: () => dismiss(latest) });
  }, [dismiss]);

  useEffect(() => {
    if (!isNativeApp()) return;
    const run = () => {
      if (busyRef.current) return;
      busyRef.current = true;
      (isAndroid() ? checkAndroid() : checkDesktop())
        .catch((err) => console.warn('update check failed', err))
        .finally(() => (busyRef.current = false));
    };
    const first = setTimeout(run, FIRST_CHECK_DELAY_MS);
    const every = setInterval(run, CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkAndroid, checkDesktop]);

  return update;
}
