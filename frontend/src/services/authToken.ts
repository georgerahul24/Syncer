// The native (Tauri) app authenticates cross-origin with a bearer token
// instead of the cookie the web app relies on — see backend
// src/auth/sessions.ts for why cross-origin cookies aren't viable here.
// Web build never calls these (isNativeApp() is false), so this storage
// stays empty and unused there.

const TOKEN_KEY = 'syncer:auth-token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // best-effort only
  }
}
