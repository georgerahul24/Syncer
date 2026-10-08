import { useEffect } from 'react';
import { useRouter } from '../router';
import { isNativeApp } from '../services/serverConfig';
import { books as booksApi } from '../services/api';

/**
 * Handles the native app being opened with a file — macOS's "Open With →
 * Syncer" from Finder (see src-tauri's bundle.fileAssociations + the
 * RunEvent::Opened handler in src-tauri/src/lib.rs, which emits this
 * 'file-opened' event). Uploads the file exactly like a manual "Add book"
 * and jumps straight into it. No-op on web — isNativeApp() gates it, and
 * these dynamic imports (Tauri-only packages) never even load there.
 */
export function useNativeFileOpen(enabled: boolean) {
  const { navigate } = useRouter();

  useEffect(() => {
    if (!enabled || !isNativeApp()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const [{ listen }, { readFile }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/plugin-fs'),
      ]);
      const off = await listen<string>('file-opened', async (event) => {
        const path = event.payload;
        const name = path.split(/[\\/]/).pop() ?? 'book';
        try {
          const bytes = await readFile(path);
          const type = name.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'application/pdf';
          const file = new File([new Uint8Array(bytes)], name, { type });
          const book = await booksApi.upload(file);
          navigate(`/book/${book.id}`);
        } catch {
          // Best-effort: no page context to surface an error in here.
        }
      });
      if (cancelled) off();
      else unlisten = off;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, navigate]);
}
