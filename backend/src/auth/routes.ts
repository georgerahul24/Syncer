import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  createAuthSession,
  destroyAuthSession,
  getSessionTokenFromRequest,
  setSessionCookie,
  clearSessionCookie,
} from './sessions.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  syncEnabled: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post(
  '/register',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new AppError(400, 'Email and password are required');
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) throw new AppError(400, 'Enter a valid email address');
    if (password.length < 8) throw new AppError(400, 'Password must be at least 8 characters');

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
    if (existing) throw new AppError(409, 'An account with this email already exists');

    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, passwordHash, syncEnabled, createdAt) VALUES (?, ?, ?, 1, ?)`
    ).run(id, normalizedEmail, hashPassword(password), new Date().toISOString());

    const token = createAuthSession(id);
    setSessionCookie(res, token);
    // Also returned in the body for the native app, which can't rely on a
    // cross-origin cookie (see getSessionTokenFromRequest) — harmless for
    // the web client, which just ignores the extra field.
    res.status(201).json({ id, email: normalizedEmail, syncEnabled: true, token });
  })
);

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new AppError(400, 'Email and password are required');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail) as
      | UserRow
      | undefined;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AppError(401, 'Invalid email or password');
    }
    const token = createAuthSession(user.id);
    setSessionCookie(res, token);
    res.json({ id: user.id, email: user.email, syncEnabled: !!user.syncEnabled, token });
  })
);

authRouter.post('/logout', (req, res) => {
  destroyAuthSession(getSessionTokenFromRequest(req));
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`SELECT id, email, syncEnabled FROM users WHERE id = ?`).get(req.userId) as
    | UserRow
    | undefined;
  if (!user) throw new AppError(401, 'Not authenticated');
  res.json({ id: user.id, email: user.email, syncEnabled: !!user.syncEnabled });
});

authRouter.put(
  '/me/sync',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
    db.prepare(`UPDATE users SET syncEnabled = ? WHERE id = ?`).run(enabled ? 1 : 0, req.userId);
    res.json({ syncEnabled: enabled });
  })
);
