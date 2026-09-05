import type { Annotation, Book, BookStats, Folder, InkStroke, NewAnnotationInput, NotebookPage, OverviewStats, ReadingPosition, SearchResult, Tag, User } from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
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

export const auth = {
  me: () => request<User>('/auth/me'),
  register: (email: string, password: string) =>
    request<User>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  setSync: (enabled: boolean) => request<{ syncEnabled: boolean }>('/auth/me/sync', { method: 'PUT', body: JSON.stringify({ enabled }) }),
};

export const books = {
  list: (filter?: { folderId?: string | null; tag?: string }) => {
    const params = new URLSearchParams();
    if (filter?.folderId !== undefined) params.set('folderId', filter.folderId ?? 'none');
    if (filter?.tag) params.set('tag', filter.tag);
    const qs = params.toString();
    return request<Book[]>(`/books${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<Book>(`/books/${id}`),
  upload: (file: File, onProgress?: (fraction: number) => void): Promise<Book> => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/books');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
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
  fileUrl: (id: string) => `/api/books/${id}/file`,
  coverUrl: (id: string) => `/api/books/${id}/cover`,
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
    navigator.sendBeacon(`/api/books/${bookId}/progress`, new Blob([JSON.stringify(body)], { type: 'application/json' }));
  },
};

export const analytics = {
  overview: () => request<OverviewStats>('/analytics/overview'),
  forBook: (bookId: string) => request<BookStats>(`/books/${bookId}/analytics`),
  /** Fire-and-forget: uses sendBeacon (survives page unload) when available, falls back to a plain request. */
  logSession: (bookId: string, body: { durationSeconds: number; startProgress: number; endProgress: number }) => {
    const payload = JSON.stringify(body);
    if (navigator.sendBeacon?.(`/api/books/${bookId}/reading-sessions`, new Blob([payload], { type: 'application/json' }))) {
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
  create: (bookId: string, afterPage: number) =>
    request<NotebookPage>(`/books/${bookId}/notebook-pages`, { method: 'POST', body: JSON.stringify({ afterPage }) }),
  update: (id: string, patch: { text?: string; strokes?: InkStroke[] }) =>
    request<NotebookPage>(`/notebook-pages/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  remove: (id: string) => request<void>(`/notebook-pages/${id}`, { method: 'DELETE' }),
};

export const search = {
  query: (q: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
};
