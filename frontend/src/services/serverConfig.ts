// Resolves which backend base URL to talk to.
//
// The web/installed-PWA build is served BY the backend (same origin), so
// relative '/api/...' paths always just work — no resolution needed there.
// The native (Tauri) build has no such origin: its assets are served from
// the OS webview's own local scheme, so it needs an absolute backend URL.
// Every saved address is probed at once and the first one to actually answer is
// used — see resolveBase().

// The server addresses this device tries. Editable in the app (Servers
// dialog) and saved on the device. Local builds can seed defaults from
// frontend/.env.local; the public release builds ship with none.
const DEFAULT_SERVERS = [import.meta.env.VITE_LOCAL_BASE, import.meta.env.VITE_REMOTE_BASE].filter(
  (u): u is string => !!u
);
const SERVERS_KEY = 'syncer:servers';

// A private-network address answers in milliseconds or not at all; anything
// else may pay a relay hop plus a TLS handshake on a cold probe. These only
// bound how long a *losing* probe delays the "nothing reachable" verdict —
// the first server to answer wins immediately.
const LOCAL_PROBE_TIMEOUT_MS = 1200;
const REMOTE_PROBE_TIMEOUT_MS = 2500;
const LAST_GOOD_KEY = 'syncer:server-base';

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

async function probe(base: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // AbortController only cancels a fetch that's already been handed to the
  // network stack — on native webviews it does NOT reliably unblock a fetch
  // still stuck opening the TCP connection itself (e.g. probing a LAN IP
  // that's genuinely unreachable, like the home network's 10.x address while
  // off that network). Racing against a plain timeout guarantees this
  // resolves within timeoutMs regardless of whether the underlying
  // connect ever gives up on its own — otherwise app boot can hang for the
  // OS's much longer TCP connect timeout instead of falling through to the
  // other base.
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    raceTimer = setTimeout(() => resolve(false), timeoutMs + 50);
  });
  try {
    return await Promise.race([
      fetch(`${base}/api/health`, { signal: controller.signal }).then((res) => res.ok),
      timeout,
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    clearTimeout(raceTimer);
  }
}

function readLastGood(): string | null {
  try {
    return localStorage.getItem(LAST_GOOD_KEY);
  } catch {
    return null;
  }
}

let resolved: Promise<string> | null = null;
// Synchronous mirror of the resolved base, for call sites that can't await
// (cover <img> URLs, books.fileUrl()). Seeded with the last base that worked
// so the library can render covers from cache before the probe settles —
// the app no longer waits on the network before showing anything.
let cachedBaseSync = isNativeApp() ? readLastGood() ?? getServerList()[0] ?? '' : '';

export type ConnectionKind = 'local' | 'remote' | 'offline';

let currentConnection: ConnectionKind | null = null;
const connectionListeners = new Set<(kind: ConnectionKind | null) => void>();

function setConnection(kind: ConnectionKind | null): void {
  currentConnection = kind;
  connectionListeners.forEach((fn) => fn(kind));
}

/** Subscribes to connection-status changes; fires immediately with the current value. Returns an unsubscribe function. */
export function subscribeConnectionKind(fn: (kind: ConnectionKind | null) => void): () => void {
  connectionListeners.add(fn);
  fn(currentConnection);
  return () => connectionListeners.delete(fn);
}

interface Candidate {
  base: string;
  kind: Exclude<ConnectionKind, 'offline'>;
  timeoutMs: number;
}

/** Trims, adds http:// when no scheme was typed, and drops trailing slashes. Null if it isn't a usable URL. */
export function normalizeServerUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** The server addresses this device tries, in the user's order. */
export function getServerList(): string[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((u): u is string => typeof u === 'string' && !!u);
    }
  } catch {
    // fall through to the defaults
  }
  if (DEFAULT_SERVERS.length) return [...DEFAULT_SERVERS];
  // Public release builds carry no addresses (they're downloadable by anyone).
  // An app updated from an older build still knows the server it last
  // reached, so start from that rather than an empty list.
  const lastGood = readLastGood();
  return lastGood ? [lastGood] : [];
}

/** Saves the list and re-resolves on the next request. An empty list restores the defaults. */
export function setServerList(list: string[]): void {
  const cleaned = [...new Set(list.map(normalizeServerUrl).filter((u): u is string => !!u))];
  try {
    if (cleaned.length) localStorage.setItem(SERVERS_KEY, JSON.stringify(cleaned));
    else localStorage.removeItem(SERVERS_KEY);
    localStorage.removeItem(LAST_GOOD_KEY);
  } catch {
    // best-effort only
  }
  forgetResolvedBase();
}

export function getDefaultServers(): string[] {
  return [...DEFAULT_SERVERS];
}

function isPrivateHost(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return (
      /^(10\.|192\.168\.|127\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === 'localhost' ||
      host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

function toCandidate(base: string): Candidate {
  const local = isPrivateHost(base);
  return { base, kind: local ? 'local' : 'remote', timeoutMs: local ? LOCAL_PROBE_TIMEOUT_MS : REMOTE_PROBE_TIMEOUT_MS };
}

/** Checks one address on its own, for the Servers dialog. Resolves with the round-trip in ms, or null if it didn't answer. */
export async function testServer(base: string): Promise<number | null> {
  const start = performance.now();
  const ok = await probe(base, REMOTE_PROBE_TIMEOUT_MS);
  return ok ? Math.round(performance.now() - start) : null;
}

/** The address currently in use, or null before one has answered. */
export function getActiveServer(): string | null {
  return currentConnection && currentConnection !== 'offline' ? cachedBaseSync : null;
}

/**
 * Probes every candidate at once and resolves with the first one that ANSWERS,
 * or null once all of them have failed.
 *
 * Deliberately not `Promise.race`: that settles on the first probe to *finish*,
 * which includes finishing unsuccessfully. A firewall that refuses the Funnel's
 * port outright (rather than dropping the packet) makes that probe the fastest
 * to settle on the college network, so a plain race would hand back "false"
 * while the LAN address was sitting right there, reachable. What we want is the
 * first `true` — and only the exhaustion of every probe counts as a real no.
 */
function firstToAnswer(): Promise<Candidate | null> {
  const candidates = getServerList().map(toCandidate);
  return new Promise((resolve) => {
    let outstanding = candidates.length;
    if (outstanding === 0) resolve(null);
    for (const candidate of candidates) {
      // `probe` resolves false rather than rejecting, so there is no rejection
      // path here that could leave `outstanding` stuck above zero.
      probe(candidate.base, candidate.timeoutMs).then((reachable) => {
        // Resolving twice is a no-op, so the first success simply wins and the
        // still-running probes are left to finish and be ignored.
        if (reachable) resolve(candidate);
        else if (--outstanding === 0) resolve(null);
      });
    }
  });
}

async function resolveBase(): Promise<string> {
  // Whichever address answers first wins. The two cover disjoint networks
  // (off campus only the Tailscale address works; on the college wifi only
  // the LAN one does), so in practice the race has one runner and the answer
  // arrives as fast as that one can give it. Ordering them instead would mean
  // waiting out the unreachable one's full timeout on every launch.
  const winner = await firstToAnswer();
  if (!winner) {
    // Neither reachable — keep the last-known-good base so URLs still build;
    // requests then fail fast with a network error, which callers treat as offline.
    setConnection('offline');
    return readLastGood() ?? getServerList()[0] ?? '';
  }
  try {
    localStorage.setItem(LAST_GOOD_KEY, winner.base);
  } catch {
    // ignore
  }
  setConnection(winner.kind);
  return winner.base;
}

/** Resolved once per app session; call `forgetResolvedBase` to force a re-probe (e.g. after a request fails). */
export function getApiBase(): Promise<string> {
  if (!isNativeApp()) return Promise.resolve('');
  if (!resolved) resolved = resolveBase().then((base) => (cachedBaseSync = base));
  return resolved;
}

/** Best-effort synchronous read of the resolved base, for callers that hand a URL string to a library (pdf.js, epub.js) rather than making the request themselves. */
export function getApiBaseSync(): string {
  return isNativeApp() ? cachedBaseSync : '';
}

export function forgetResolvedBase(): void {
  resolved = null;
  setConnection(null);
}
