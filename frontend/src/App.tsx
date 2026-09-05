import { useEffect } from 'react';
import { useRouter } from './router';
import { useAuth } from './hooks/useAuth';
import AuthPage from './pages/AuthPage';
import LibraryPage from './pages/LibraryPage';
import ReaderPage from './pages/ReaderPage';

export default function App() {
  const { path, navigate } = useRouter();
  const { user, loading } = useAuth();

  const bookMatch = /^\/book\/([^/]+)$/.exec(path);

  useEffect(() => {
    if (loading) return;
    const isAuthRoute = path === '/login' || path === '/register';
    if (!user && !isAuthRoute) navigate('/login', { replace: true });
    if (user && isAuthRoute) navigate('/', { replace: true });
  }, [loading, user, path, navigate]);

  if (loading) return null;

  if (!user) {
    return <AuthPage mode={path === '/register' ? 'register' : 'login'} />;
  }

  if (bookMatch) {
    return <ReaderPage bookId={bookMatch[1]} />;
  }

  return <LibraryPage />;
}
