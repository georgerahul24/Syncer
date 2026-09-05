import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

// A minimal in-memory sliding-window limiter — enough to blunt naive
// credential-stuffing/brute-force against a single self-hosted instance
// without pulling in a dependency for it. Keyed by IP + a caller-supplied
// discriminator (e.g. the submitted email) so one slow attacker can't lock
// out other users sharing an IP (NAT, corporate network) from their own
// accounts, while still limiting attempts against any one account.
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: buckets are small and expire on their own via `resetAt`,
// but a sustained attack still shouldn't be allowed to grow this map
// without limit.
const MAX_BUCKETS = 50_000;

export function rateLimit(opts: { windowMs: number; max: number; keySuffix?: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const suffix = opts.keySuffix?.(req) ?? '';
    const key = `${req.ip}:${suffix}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      if (buckets.size >= MAX_BUCKETS) buckets.clear();
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      throw new AppError(429, 'Too many attempts. Please wait a moment and try again.');
    }
    next();
  };
}
