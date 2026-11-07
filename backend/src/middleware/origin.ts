import type { IncomingMessage } from 'node:http';
import { NATIVE_ORIGINS } from '../config.js';

/**
 * True for a request from this server's own pages (same host) or from one of
 * the native apps. Anything else — another website the user happens to have
 * open — gets no CORS access and no WebSocket.
 *
 * Compared by hostname: nginx forwards `Host` without the Funnel's port.
 */
export function isTrustedOrigin(origin: string | undefined, req: IncomingMessage): boolean {
  if (!origin) return true; // not a browser cross-origin request
  if (NATIVE_ORIGINS.has(origin)) return true;
  try {
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
    return new URL(origin).hostname === host.split(':')[0];
  } catch {
    return false;
  }
}
