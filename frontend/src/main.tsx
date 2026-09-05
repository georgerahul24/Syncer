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
