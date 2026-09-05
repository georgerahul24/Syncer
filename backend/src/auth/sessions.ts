import { randomBytes, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { db } from '../database/db.js';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, IS_PROD } from '../config.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(
    `INSERT INTO auth_sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)`
  ).run(hashToken(token), userId, now.toISOString(), expires.toISOString());
  return token;
}

export function resolveAuthSession(token: string | undefined): { userId: string } | null {
  if (!token) return null;
  const row = db
    .prepare(`SELECT userId, expiresAt FROM auth_sessions WHERE token = ?`)
    .get(hashToken(token)) as { userId: string; expiresAt: string } | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(hashToken(token));
    return null;
  }
  return { userId: row.userId };
}

export function destroyAuthSession(token: string | undefined): void {
  if (!token) return;
  db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(hashToken(token));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getSessionTokenFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  if (IS_PROD) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const attrs = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0', 'SameSite=Lax'];
  if (IS_PROD) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
