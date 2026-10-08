import { lazy, Suspense, useEffect } from 'react';
import { useRouter } from './router';
import { useAuth } from './hooks/useAuth';
import { useNativeFileOpen } from './hooks/useNativeFileOpen';
import LibraryPage from './pages/LibraryPage';

// The library is the page almost every launch lands on, so it ships in the
// main bundle. Everything else — the readers carry pdf.js and epub.js, by far
// the heaviest code in the app — loads only when it's actually opened.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ReaderPage = lazy(() => import('./pages/ReaderPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));

// Warm the reader chunk once the library is idle, so the first tap on a
// book doesn't also wait on downloading the reader code.
function prefetchReader() {
  const run = () => void import('./pages/ReaderPage');
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

export default function App() {
  const { path, navigate } = useRouter();
  const { user, loading } = useAuth();
  useNativeFileOpen(!!user);

  const bookMatch = /^\/book\/([^/]+)$/.exec(path);

  useEffect(() => {
    if (loading) return;
    const isAuthRoute = path === '/login' || path === '/register';
    if (!user && !isAuthRoute) navigate('/login', { replace: true });
    if (user && isAuthRoute) navigate('/', { replace: true });
  }, [loading, user, path, navigate]);

  useEffect(() => {
    if (user) prefetchReader();
  }, [user]);

  if (loading) return null;

  let page;
  if (!user) page = <AuthPage mode={path === '/register' ? 'register' : 'login'} />;
  else if (bookMatch) page = <ReaderPage bookId={bookMatch[1]} />;
  else if (path === '/dashboard') page = <DashboardPage />;
  else page = <LibraryPage />;

  return <Suspense fallback={null}>{page}</Suspense>;
}
