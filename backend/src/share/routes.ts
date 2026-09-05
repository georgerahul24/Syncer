import { Router } from 'express';
import { upload } from '../books/routes.js';
import { createBookFromUpload } from '../books/createBook.js';
import { resolveAuthSession, parseCookies } from '../auth/sessions.js';
import { SESSION_COOKIE_NAME } from '../config.js';

export const shareTargetRouter = Router();

/**
 * Handles Android's Web Share Target ("Share to Syncer" in the OS share
 * sheet) — see frontend/public/manifest.webmanifest's `share_target`. This
 * is a real browser-initiated <form>-style POST navigation, not a fetch()
 * call from our own JS, so unlike the rest of the API it responds with
 * redirects (a real page to land on) rather than JSON, and checks auth
 * manually instead of using the requireAuth middleware (which would just
 * send a raw 401 JSON body to a full-page navigation).
 */
shareTargetRouter.post('/share-target', upload.single('file'), async (req, res) => {
  const session = resolveAuthSession(parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]);
  if (!session) {
    res.redirect(302, '/login');
    return;
  }
  const file = req.file;
  if (!file) {
    res.redirect(302, `/?error=${encodeURIComponent('No file was shared')}`);
    return;
  }
  try {
    const book = await createBookFromUpload(session.userId, file.path, file.originalname);
    res.redirect(302, `/book/${book.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This file could not be added';
    res.redirect(302, `/?error=${encodeURIComponent(message)}`);
  }
});
