import http from 'node:http';
import type { Express } from 'express';

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

  get cookieHeader(): string | null {
    return this.cookie;
  }
}
