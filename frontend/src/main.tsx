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

// Registers the (deliberately no-op) service worker so the app meets PWA
// installability criteria on Android — see public/sw.js for why it does
// nothing beyond existing. Requires HTTPS in production (or localhost).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal — the app works fine without it, just isn't installable.
    });
  });
}
