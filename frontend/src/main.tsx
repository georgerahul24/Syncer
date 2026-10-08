import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RouterProvider } from './router';
import { AuthProvider } from './hooks/useAuth';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </RouterProvider>
  </StrictMode>
);

// Registers the service worker: meets PWA installability criteria on
// Android, caches the app shell for offline launch, and serves book
// files/covers from a downloaded copy when a book was marked "available
// offline" (frontend/src/utils/offlineBooks.ts) — see public/sw.js.
// Requires HTTPS in production (or localhost).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal — the app works fine without it, just isn't installable.
    });
  });
}
