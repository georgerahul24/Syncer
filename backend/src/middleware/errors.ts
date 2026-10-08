import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

// Thrown deliberately by route handlers for expected failure conditions
// (bad input, not found, forbidden). Anything else (a thrown Error, a bug)
// is logged server-side and reported to the client as a generic 500 —
// callers must never see raw error messages/stack traces.
export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express detects an error-handling middleware by checking fn.length === 4
  // — this parameter has to stay even though the body never reads it, or
  // this stops being an error handler at all and silently never runs.
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed';
    res.status(400).json({ error: message });
    return;
  }
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

export function asyncRoute<T extends (req: Request, res: Response) => Promise<void>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
