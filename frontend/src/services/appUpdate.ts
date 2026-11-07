import { appRelease } from './api';
import { isNativeApp } from './serverConfig';

// Every push to main that touches the app publishes a GitHub release
// (.github/workflows/release.yml). Both native apps watch for them:
//
//   - Desktop uses Tauri's updater: it reads latest.json, downloads the
//     signed bundle, verifies it against the public key in tauri.conf.json,
//     swaps the app in place and relaunches.
//   - Android can't replace a sideloaded app by itself. It asks the Syncer
//     server for the latest release (see backend appRelease/routes.ts) and,
//     on tap, opens the APK's download link; the system installer does the
//     rest.
//
// Kept as a tiny store outside React so the automatic check (App) and the
// "Check for updates" menu item (LibraryPage) share one state.

const DISMISSED_KEY = 'syncer:update-dismissed';

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'installing'; version: string; progress: number | null }
  | { state: 'failed'; message: string };

let current: UpdateState = { state: 'idle' };
let pendingInstall: (() => Promise<void>) | null = null;
const listeners = new Set<(s: UpdateState) => void>();

function set(next: UpdateState) {
  current = next;
  listeners.forEach((fn) => fn(next));
}

export function subscribeUpdate(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** True when version `a` is newer than `b` (plain x.y.z). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
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

export async function getAppVersion(): Promise<string | null> {
  if (!isNativeApp()) return null;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return `Couldn't check for updates (${text}).`;
}

/**
 * Looks for a newer release. `manual` is a check the user asked for: it
 * ignores a version they dismissed earlier, and reports "up to date" and
 * errors instead of staying silent.
 */
export async function checkForUpdate({ manual = false }: { manual?: boolean } = {}): Promise<void> {
  if (!isNativeApp() || current.state === 'checking' || current.state === 'installing') return;
  const before = current;
  if (manual) set({ state: 'checking' });
  try {
    const installed = (await getAppVersion()) ?? '0';
    if (isAndroid()) {
      const latest = await appRelease.latest();
      if (latest.apkUrl && isNewer(latest.version, installed) && (manual || !wasDismissed(latest.version))) {
        const url = latest.apkUrl;
        pendingInstall = async () => {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(url);
          set({ state: 'idle' });
        };
        set({ state: 'available', version: latest.version });
      } else {
        set(manual ? { state: 'up-to-date', version: installed } : before);
      }
      return;
    }
    const { check } = await import('@tauri-apps/plugin-updater');
    const found = await check();
    if (found && (manual || !wasDismissed(found.version))) {
      const version = found.version;
      pendingInstall = async () => {
        set({ state: 'installing', version, progress: null });
        let total = 0;
        let received = 0;
        await found.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0;
          else if (event.event === 'Progress') {
            received += event.data.chunkLength;
            set({ state: 'installing', version, progress: total ? received / total : null });
          }
        });
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      };
      set({ state: 'available', version });
    } else {
      set(manual ? { state: 'up-to-date', version: installed } : before);
    }
  } catch (err) {
    console.warn('update check failed', err);
    set(manual ? { state: 'failed', message: describe(err) } : before);
  }
}

export function installUpdate(): void {
  const run = pendingInstall;
  if (!run) return;
  run().catch((err) => {
    console.error('update failed', err);
    set({ state: 'failed', message: `The update could not be installed (${err instanceof Error ? err.message : String(err)}).` });
  });
}

/** Hides the banner; an automatic check won't offer this version again, a manual one will. */
export function dismissUpdate(): void {
  if (current.state === 'available') {
    try {
      localStorage.setItem(DISMISSED_KEY, current.version);
    } catch {
      // best-effort only
    }
  }
  set({ state: 'idle' });
}
