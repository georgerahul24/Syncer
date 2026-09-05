import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../middleware/errors.js';
import { getOwnedBook } from '../books/access.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// A book with no known page count (every EPUB, and a PDF metadata
// extraction that failed to find one) falls back to this so "pages read"
// and "characters read" still show *something* — always labeled as an
// estimate in the API shape (`isEstimate`) so the frontend never presents
// it as an exact count. 2000 chars/page is a commonly-cited rough average
// for a printed book page.
const CHARS_PER_PAGE_ESTIMATE = 2000;
const DEFAULT_PAGE_COUNT_ESTIMATE = 300;

analyticsRouter.post(
  '/books/:id/reading-sessions',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const { durationSeconds, startProgress, endProgress } = req.body ?? {};
    if (typeof durationSeconds !== 'number' || durationSeconds <= 0 || durationSeconds > 24 * 3600) {
      throw new AppError(400, 'durationSeconds must be a positive number of seconds');
    }
    if (typeof startProgress !== 'number' || typeof endProgress !== 'number') {
      throw new AppError(400, 'startProgress and endProgress are required');
    }
    const clampedStart = Math.max(0, Math.min(1, startProgress));
    const clampedEnd = Math.max(0, Math.min(1, endProgress));
    const pageCount = book.pageCount ?? DEFAULT_PAGE_COUNT_ESTIMATE;
    const pagesRead = Math.max(0, Math.round((clampedEnd - clampedStart) * pageCount));

    const now = new Date().toISOString();
    const endedAt = now;
    const startedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    db.prepare(
      `INSERT INTO reading_sessions_log (id, userId, bookId, startedAt, endedAt, durationSeconds, startProgress, endProgress, pagesRead, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), req.userId, book.id, startedAt, endedAt, Math.round(durationSeconds), clampedStart, clampedEnd, pagesRead, now);
    res.status(201).json({ ok: true });
  })
);

interface AggRow {
  totalSeconds: number | null;
  sessionCount: number | null;
  maxProgress: number | null;
  firstReadAt: string | null;
  lastReadAt: string | null;
  pagesRead: number | null;
}

function computeStreaks(days: string[]): { current: number; longest: number } {
  // `days` are distinct 'YYYY-MM-DD' strings (UTC — see the module comment
  // in analytics/README.md for why this is a documented simplification),
  // sorted descending (most recent first).
  if (days.length === 0) return { current: 0, longest: 0 };
  const oneDayMs = 24 * 60 * 60 * 1000;
  const toDate = (s: string) => new Date(`${s}T00:00:00Z`).getTime();

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = (toDate(days[i - 1]) - toDate(days[i])) / oneDayMs;
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMs = toDate(todayStr);
  let current = 0;
  if (toDate(days[0]) === todayMs || toDate(days[0]) === todayMs - oneDayMs) {
    current = 1;
    for (let i = 1; i < days.length; i++) {
      const gap = (toDate(days[i - 1]) - toDate(days[i])) / oneDayMs;
      if (gap === 1) current++;
      else break;
    }
  }
  return { current, longest };
}

analyticsRouter.get(
  '/analytics/overview',
  asyncRoute(async (req, res) => {
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(durationSeconds),0) AS totalSeconds,
                COUNT(*) AS sessionCount,
                COALESCE(SUM(pagesRead),0) AS pagesRead,
                MIN(startedAt) AS firstReadAt,
                MAX(endedAt) AS lastReadAt
         FROM reading_sessions_log WHERE userId = ?`
      )
      .get(req.userId) as AggRow;

    const distinctBooks = (
      db.prepare(`SELECT COUNT(DISTINCT bookId) AS c FROM reading_sessions_log WHERE userId = ?`).get(req.userId) as {
        c: number;
      }
    ).c;

    const days = (
      db
        .prepare(
          `SELECT DISTINCT substr(endedAt, 1, 10) AS day FROM reading_sessions_log WHERE userId = ? ORDER BY day DESC`
        )
        .all(req.userId) as Array<{ day: string }>
    ).map((r) => r.day);
    const { current, longest } = computeStreaks(days);

    const last14 = db
      .prepare(
        `SELECT substr(endedAt, 1, 10) AS day, SUM(durationSeconds) AS seconds
         FROM reading_sessions_log
         WHERE userId = ? AND endedAt >= datetime('now', '-14 days')
         GROUP BY day ORDER BY day ASC`
      )
      .all(req.userId) as Array<{ day: string; seconds: number }>;

    const totalSeconds = agg.totalSeconds ?? 0;
    const sessionCount = agg.sessionCount ?? 0;
    res.json({
      totalSeconds,
      sessionCount,
      booksRead: distinctBooks,
      pagesRead: agg.pagesRead ?? 0,
      estimatedCharactersRead: Math.round((agg.pagesRead ?? 0) * CHARS_PER_PAGE_ESTIMATE),
      avgSessionSeconds: sessionCount > 0 ? Math.round(totalSeconds / sessionCount) : 0,
      currentStreakDays: current,
      longestStreakDays: longest,
      firstReadAt: agg.firstReadAt,
      lastReadAt: agg.lastReadAt,
      last14Days: last14,
      isEstimate: { estimatedCharactersRead: true, pagesRead: true },
    });
  })
);

analyticsRouter.get(
  '/books/:id/analytics',
  asyncRoute(async (req, res) => {
    const book = getOwnedBook(req.userId!, req.params.id);
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(durationSeconds),0) AS totalSeconds,
                COUNT(*) AS sessionCount,
                COALESCE(MAX(endProgress),0) AS maxProgress,
                COALESCE(SUM(pagesRead),0) AS pagesRead,
                MIN(startedAt) AS firstReadAt,
                MAX(endedAt) AS lastReadAt
         FROM reading_sessions_log WHERE userId = ? AND bookId = ?`
      )
      .get(req.userId, book.id) as AggRow;

    const totalSeconds = agg.totalSeconds ?? 0;
    const sessionCount = agg.sessionCount ?? 0;
    res.json({
      totalSeconds,
      sessionCount,
      avgSessionSeconds: sessionCount > 0 ? Math.round(totalSeconds / sessionCount) : 0,
      maxProgress: agg.maxProgress ?? 0,
      pagesRead: agg.pagesRead ?? 0,
      estimatedCharactersRead: Math.round((agg.pagesRead ?? 0) * CHARS_PER_PAGE_ESTIMATE),
      firstReadAt: agg.firstReadAt,
      lastReadAt: agg.lastReadAt,
      isEstimate: { estimatedCharactersRead: true, pagesRead: !book.pageCount },
    });
  })
);
