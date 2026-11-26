// localStorage can throw (private mode, blocked site data, a full quota) and
// can hold anything, so every read and write goes through these, which never
// throw. Storage here is always best-effort: a failed write is dropped and a
// failed read looks like "nothing saved".

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves `value`, or removes the key when it's null. */
export function writeString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // best-effort only
  }
}

export function readJSON<T>(key: string): T | null {
  const raw = readString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Saves `value` as JSON, or removes the key when it's null. */
export function writeJSON(key: string, value: unknown): void {
  writeString(key, value === null ? null : JSON.stringify(value));
}
