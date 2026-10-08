import type { Request, Response, NextFunction } from 'express';
import { getSessionTokenFromRequest, resolveAuthSession } from '../auth/sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getSessionTokenFromRequest(req);
  const session = resolveAuthSession(token);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.userId = session.userId;
  next();
}
