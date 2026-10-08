import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '../types';
import { ApiError } from '../services/api';
import { auth as authApi } from '../services/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const CACHED_USER_KEY = 'syncer:cached-user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    // best-effort only
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // A device that was signed in last time opens straight into the app with
  // that session, and the server check below runs in the background. Waiting
  // on it first meant a slow or dead connection held the whole app on a blank
  // screen for as long as the request took to fail.
  const [user, setUser] = useState<User | null>(readCachedUser);
  const [loading, setLoading] = useState(() => readCachedUser() === null);

  useEffect(() => {
    authApi
      .me()
      .then((u) => {
        setUser(u);
        writeCachedUser(u);
      })
      .catch((err) => {
        // Only a real 401 signs the device out. Anything else (offline,
        // server unreachable, a 5xx) keeps the cached session — the auth
        // cookie/token is untouched and works again once the server is back.
        if (err instanceof ApiError && err.status === 401) {
          writeCachedUser(null);
          setUser(null);
        } else if (!readCachedUser()) {
          console.error(err);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await authApi.login(email, password);
    setUser(u);
    writeCachedUser(u);
  }, []);
  const register = useCallback(async (email: string, password: string) => {
    const u = await authApi.register(email, password);
    setUser(u);
    writeCachedUser(u);
  }, []);
  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    writeCachedUser(null);
  }, []);
  const setUserAndCache = useCallback((u: User) => {
    setUser(u);
    writeCachedUser(u);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, register, logout, setUser: setUserAndCache }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
