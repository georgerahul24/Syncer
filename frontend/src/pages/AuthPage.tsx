import { useState, type FormEvent } from 'react';
import { useRouter } from '../router';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../services/api';
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>Syncer</h1>
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
