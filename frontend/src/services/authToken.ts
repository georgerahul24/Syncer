import { readString, writeString } from '../utils/storage';

// The native (Tauri) app authenticates cross-origin with a bearer token
// instead of the cookie the web app relies on — see backend
// src/auth/sessions.ts for why cross-origin cookies aren't viable here.
// Web build never calls these (isNativeApp() is false), so this storage
// stays empty and unused there.

const TOKEN_KEY = 'syncer:auth-token';

export const getStoredToken = () => readString(TOKEN_KEY);
export const setStoredToken = (token: string | null) => writeString(TOKEN_KEY, token || null);
