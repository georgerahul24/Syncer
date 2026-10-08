import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface RouterContextValue {
  path: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

/**
 * A deliberately tiny History-API router: this app has exactly three
 * destinations (auth, library, a book), which doesn't justify pulling in
 * react-router (see instructions.md section 2, "avoid unnecessary
 * dependencies").
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    // Re-read from the browser rather than trusting `to` verbatim — `path`
    // is matched elsewhere (App.tsx) as a bare pathname, so a `to` that
    // carries a query string (e.g. a search-result jump target) must have
    // it stripped the same way the popstate handler above already does,
    // or a route regex like /^\/book\/([^/]+)$/ swallows the query string
    // into its capture group instead of matching it as a separate part.
    setPath(window.location.pathname);
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
