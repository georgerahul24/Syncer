import type { Annotation, Book, BookStats, Folder, InkStroke, NewAnnotationInput, NotebookPage, OverviewStats, ReadingPosition, SearchResult, Tag, User } from '../types';
import { forgetResolvedBase, getApiBase, getApiBaseSync, isNativeApp } from './serverConfig';
import { getStoredToken, setStoredToken } from './authToken';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// The native app has no cookie to rely on cross-origin, so it authenticates
// with a bearer token instead (see backend src/auth/sessions.ts). Web stays
// on cookies untouched — isNativeApp() is false there, so this is a no-op.
function authHeaders(): Record<string, string> {
  if (!isNativeApp()) return {};
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Resolves a server-relative asset path (e.g. a book's file/cover) to a URL a plain <img>/pdf.js/epub.js request can use — those can't attach an Authorization header, so the native app carries its token as a query param instead. Web keeps the plain relative path. */
function assetUrl(path: string): string {
  if (!isNativeApp()) return path;
  const token = getStoredToken();
  const sep = path.includes('?') ? '&' : '?';
  return `${getApiBaseSync()}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`;
}

function withResolvedCover(book: Book): Book {
  return book.coverUrl ? { ...book, coverUrl: assetUrl(book.coverUrl) } : book;
}

// Same platform quirk as serverConfig.ts's health probe: on native webviews,
// AbortController doesn't reliably unblock a fetch still stuck opening the
// TCP connection (as opposed to one already reading a response) — so a base
// that goes unreachable mid-session (wifi drops, left the home network)
// could otherwise hang a request indefinitely instead of failing over. Only
// applies to the native app; the web build's relative paths always resolve
// same-origin and don't have this "wrong network" failure mode.
const REQUEST_TIMEOUT_MS = 8000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  let res: Response;
  try {
    const fetchPromise = fetch(`${base}/api${path}`, {
      credentials: 'include',
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      ...init,
    });
    if (!isNativeApp()) {
      res = await fetchPromise;
    } else {
      // Cleared in the finally below rather than left to fire: without that,
      // every native request leaves a live 8-second timer behind, so a screen
      // that issues a burst of them (the library: books, folders, tags) keeps
      // a pile of pending timers around long after the responses are in.
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        res = await Promise.race([
          fetchPromise,
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new TypeError('Request timed out')), REQUEST_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
      }
    }
  } catch (err) {
    // A resolved base can go stale (left the home network mid-session,
    // server restarted, etc.) — drop it so the next request re-probes
    // local-vs-remote instead of retrying a base that's now unreachable.
    forgetResolvedBase();
    throw err;
  }
  if (!res.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function captureToken(res: User & { token?: string }): User {
  if (isNativeApp()) setStoredToken(res.token ?? null);
  const { token: _token, ...user } = res;
  return user;
}

export const auth = {
  me: () => request<User>('/auth/me'),
  register: (email: string, password: string) =>
    request<User & { token?: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }).then(captureToken),
  login: (email: string, password: string) =>
    request<User & { token?: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }).then(captureToken),
  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }).then(() => {
      if (isNativeApp()) setStoredToken(null);
    }),
  setSync: (enabled: boolean) => request<{ syncEnabled: boolean }>('/auth/me/sync', { method: 'PUT', body: JSON.stringify({ enabled }) }),
};

export const books = {
  list: (filter?: { folderId?: string | null; tag?: string }) => {
    const params = new URLSearchParams();
    if (filter?.folderId !== undefined) params.set('folderId', filter.folderId ?? 'none');
    if (filter?.tag) params.set('tag', filter.tag);
    const qs = params.toString();
    return request<Book[]>(`/books${qs ? `?${qs}` : ''}`).then((list) => list.map(withResolvedCover));
  },
  get: (id: string) => request<Book>(`/books/${id}`).then(withResolvedCover),
  upload: (file: File, onProgress?: (fraction: number) => void): Promise<Book> => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getApiBaseSync()}/api/books`);
      xhr.withCredentials = true;
      for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(withResolvedCover(body));
          else reject(new ApiError(xhr.status, body?.error ?? 'Upload failed'));
        } catch {
          reject(new ApiError(xhr.status, 'Upload failed'));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection.'));
      xhr.send(form);
    });
  },
  remove: (id: string) => request<void>(`/books/${id}`, { method: 'DELETE' }),
  setSync: (id: string, enabled: boolean) =>
    request<{ syncEnabled: boolean }>(`/books/${id}/sync`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setFolder: (id: string, folderId: string | null) =>
    request<{ folderId: string | null }>(`/books/${id}/folder`, { method: 'PUT', body: JSON.stringify({ folderId }) }),
  fileUrl: (id: string) => assetUrl(`/api/books/${id}/file`),
  coverUrl: (id: string) => assetUrl(`/api/books/${id}/cover`),
  saveTextContent: (id: string, content: string) =>
    request<void>(`/books/${id}/content`, { method: 'PUT', body: JSON.stringify({ content }) }),
};

export const folders = {
  list: () => request<Folder[]>('/folders'),
  create: (name: string) => request<Folder>('/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) => request<Folder>(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => request<void>(`/folders/${id}`, { method: 'DELETE' }),
};

export const tags = {
  list: () => request<Tag[]>('/tags'),
  addToBook: (bookId: string, name: string) =>
    request<Tag>(`/books/${bookId}/tags`, { method: 'POST', body: JSON.stringify({ name }) }),
  removeFromBook: (bookId: string, tagId: string) => request<void>(`/books/${bookId}/tags/${tagId}`, { method: 'DELETE' }),
  remove: (id: string) => request<void>(`/tags/${id}`, { method: 'DELETE' }),
};

export const progress = {
  get: (bookId: string) => request<ReadingPosition | null>(`/books/${bookId}/progress`),
  put: (bookId: string, body: { locationType: string; location: unknown; progress: number }) =>
    request<{ shared: boolean; revision?: number }>(`/books/${bookId}/progress`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Best-effort save on page unload; can't use fetch reliably in that context. */
  beacon: (bookId: string, body: { locationType: string; location: unknown; progress: number }) => {
    // sendBeacon can't set an Authorization header — native carries its
    // token as a query param here too (see assetUrl).
    navigator.sendBeacon(assetUrl(`/api/books/${bookId}/progress`), new Blob([JSON.stringify(body)], { type: 'application/json' }));
  },
};

export const analytics = {
  overview: () => request<OverviewStats>('/analytics/overview'),
  forBook: (bookId: string) => request<BookStats>(`/books/${bookId}/analytics`),
  /** Fire-and-forget: uses sendBeacon (survives page unload) when available, falls back to a plain request. */
  logSession: (bookId: string, body: { durationSeconds: number; startProgress: number; endProgress: number; readProgressDelta: number }) => {
    const payload = JSON.stringify(body);
    if (navigator.sendBeacon?.(assetUrl(`/api/books/${bookId}/reading-sessions`), new Blob([payload], { type: 'application/json' }))) {
      return;
    }
    request(`/books/${bookId}/reading-sessions`, { method: 'POST', body: payload }).catch(() => {});
  },
};

export const annotations = {
  list: (bookId: string) => request<Annotation[]>(`/books/${bookId}/annotations`),
  create: (bookId: string, input: NewAnnotationInput) =>
    request<Annotation>(`/books/${bookId}/annotations`, { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, patch: { color?: string; note?: string | null }) =>
    request<Annotation>(`/annotations/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  remove: (id: string) => request<void>(`/annotations/${id}`, { method: 'DELETE' }),
};

export const notebookPages = {
  list: (bookId: string) => request<NotebookPage[]>(`/books/${bookId}/notebook-pages`),
  create: (bookId: string, location: { afterPage: number } | { overlayPage: number }, initial?: { text?: string; strokes?: InkStroke[] }) =>
    request<NotebookPage>(`/books/${bookId}/notebook-pages`, { method: 'POST', body: JSON.stringify({ ...location, ...initial }) }),
  update: (id: string, patch: { text?: string; strokes?: InkStroke[] }) =>
    request<NotebookPage>(`/notebook-pages/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  remove: (id: string) => request<void>(`/notebook-pages/${id}`, { method: 'DELETE' }),
};

export const search = {
  query: (q: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
};
