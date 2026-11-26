import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Express } from 'express';

// Nothing here may statically import app/config/db: those read DATA_DIR at
// module-evaluation time, so startTestServer() sets it first and only then
// loads the app.

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const pdfBytes = fs.readFileSync(path.join(fixturesDir, 'sample.pdf'));
export const epubBytes = fs.readFileSync(path.join(fixturesDir, 'sample.epub'));

export function listen(app: Express): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Points DATA_DIR at a fresh temp dir, then boots the app on a free port and closes it after the file's tests. */
export async function startTestServer() {
  process.env.DATA_DIR = path.join(os.tmpdir(), `syncer-test-${randomUUID()}`);
  const { createApp } = await import('../app.js');
  const { server, baseUrl } = await listen(createApp());
  test.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  return { server, baseUrl };
}

/** Minimal cookie-jar fetch wrapper: this app only ever sets one session cookie at a time. */
export class TestClient {
  private cookie: string | null = null;
  constructor(private baseUrl: string) {}

  async request(method: string, urlPath: string, body?: unknown, extraHeaders?: Record<string, string>) {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers['Cookie'] = this.cookie;
    const res = await fetch(this.baseUrl + urlPath, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = setCookie.find((c) => c.startsWith('syncer_session='));
    if (sessionCookie) this.cookie = sessionCookie.split(';')[0];
    return res;
  }

  get(urlPath: string) {
    return this.request('GET', urlPath);
  }
  post(urlPath: string, body?: unknown) {
    return this.request('POST', urlPath, body);
  }
  put(urlPath: string, body?: unknown) {
    return this.request('PUT', urlPath, body);
  }
  delete(urlPath: string) {
    return this.request('DELETE', urlPath);
  }

  /** Signs up (which also signs in) with a fresh address unless one is given. */
  register(email = `user-${randomUUID()}@example.com`, password = 'correct-horse') {
    return this.post('/api/auth/register', { email, password });
  }

  /** Multipart upload of one file as this client (or signed out, before register()). */
  upload(content: Buffer | string, filename: string, opts: { urlPath?: string; type?: string; redirect?: RequestRedirect } = {}) {
    const form = new FormData();
    form.append('file', new Blob([content], opts.type ? { type: opts.type } : {}), filename);
    return fetch(this.baseUrl + (opts.urlPath ?? '/api/books'), {
      method: 'POST',
      headers: this.cookie ? { Cookie: this.cookie } : {},
      body: form,
      redirect: opts.redirect,
    });
  }

  get cookieHeader(): string | null {
    return this.cookie;
  }
}

/** A signed-in user with the sample PDF already in their library. */
export async function newUserWithBook(baseUrl: string) {
  const client = new TestClient(baseUrl);
  await client.register();
  const book = await (await client.upload(pdfBytes, 'book.pdf')).json();
  return { client, book };
}
