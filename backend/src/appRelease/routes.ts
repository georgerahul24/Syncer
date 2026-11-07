import { Router } from 'express';
import { asyncRoute, AppError } from '../middleware/errors.js';

// The latest published app release, for the Android app's update check
// (frontend/src/services/appUpdate.ts). Asked of this server rather than of
// GitHub directly because the app can always reach its own server, while a
// phone's direct GitHub request can fail on its own (captive networks,
// blocked hosts, the shared unauthenticated API limit). Cached so a fleet
// of devices checking costs GitHub one request every few minutes.
const RELEASES_API = `https://api.github.com/repos/${process.env.RELEASES_REPO ?? 'georgerahul24/Syncer'}/releases/latest`;
const CACHE_MS = 10 * 60 * 1000;

interface Release {
  version: string;
  apkUrl: string | null;
  dmgUrl: string | null;
  publishedAt: string;
}

let cached: { at: number; release: Release } | null = null;

async function fetchLatest(): Promise<Release> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.release;
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'syncer-server' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new AppError(502, `GitHub answered ${res.status}`);
  const body = (await res.json()) as {
    tag_name: string;
    published_at: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };
  const asset = (suffix: string) => body.assets.find((a) => a.name.endsWith(suffix))?.browser_download_url ?? null;
  const release = {
    version: body.tag_name.replace(/^v/, ''),
    apkUrl: asset('.apk'),
    dmgUrl: asset('.dmg'),
    publishedAt: body.published_at,
  };
  cached = { at: Date.now(), release };
  return release;
}

export const appReleaseRouter = Router();

appReleaseRouter.get(
  '/app-release',
  asyncRoute(async (_req, res) => {
    res.json(await fetchLatest());
  })
);
