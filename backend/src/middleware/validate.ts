import { AppError } from './errors.js';

// Small request-body checks shared by the route modules. Each throws a 400
// AppError with a message safe to show the user.

/** A required, trimmed display name such as a folder or tag name. */
export function requireName(raw: unknown, label: string, maxLength: number): string {
  const name = String(raw ?? '').trim();
  if (!name) throw new AppError(400, `${label} name is required`);
  if (name.length > maxLength) throw new AppError(400, `${label} name is too long`);
  return name;
}

/** The `{ enabled: boolean }` body of the sync on/off switches. */
export function requireEnabledFlag(body: unknown): boolean {
  const enabled = (body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
  return enabled;
}

/** Sign-in and sign-up credentials, with the email normalized. */
export function requireCredentials(body: unknown): { email: string; password: string } {
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new AppError(400, 'Email and password are required');
  }
  return { email: email.trim().toLowerCase(), password };
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
