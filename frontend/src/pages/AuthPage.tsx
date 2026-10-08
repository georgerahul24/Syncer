import { useState, type FormEvent } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../services/api';
import ConnectionBanner from '../components/ConnectionBanner';
import styles from './AuthPage.module.css';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { navigate } = useRouter();
  const { login, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      // A non-ApiError here means the request never got a response at all
      // (native app, neither LOCAL_BASE nor the Tailscale base reachable, or
      // it timed out) — say so specifically instead of the generic message,
      // since that's exactly the case the connection banner above is meant
      // to help diagnose.
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Check your connection (or Tailscale) and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <ConnectionBanner />
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <div className={styles.logo} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 512 512" fill="none">
              <path
                d="M256 168c-28-24-70-36-112-36-14 0-28 1-40 4v268c12-3 26-4 40-4 42 0 84 12 112 36 28-24 70-36 112-36 14 0 28 1 40 4V136c-12-3-26-4-40-4-42 0-84 12-112 36z"
                stroke="currentColor"
                strokeWidth="26"
                strokeLinejoin="round"
              />
              <line x1="256" y1="168" x2="256" y2="404" stroke="currentColor" strokeWidth="26" />
            </svg>
          </div>
          <h1 className={styles.brand}>Syncer</h1>
          <p className={styles.tagline}>{mode === 'login' ? 'Welcome back.' : 'Your reading, everywhere.'}</p>
        </div>
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.submit} disabled={submitting}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className={styles.switch}>
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button type="button" onClick={() => navigate('/register')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => navigate('/login')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
