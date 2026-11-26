import { useCallback, useEffect, useState } from 'react';
import type { ReaderSettings } from '../types';
import { readJSON, writeJSON } from '../utils/storage';

const STORAGE_KEY = 'syncer:reader-settings:v1';

const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontFamily: 'georgia',
  fontSize: 18,
  lineHeight: 1.6,
  padding: { top: 24, right: 96, bottom: 24, left: 96 },
  pdfZoom: 'fit-width',
  mode: 'continuous',
};

function load(): ReaderSettings {
  return { ...DEFAULT_READER_SETTINGS, ...readJSON<Partial<ReaderSettings>>(STORAGE_KEY) };
}

/**
 * Reader appearance settings (theme, font, layout) are intentionally kept
 * in localStorage rather than the server: they're a browser/device-level
 * reading preference, not part of the cross-device sync surface (only
 * reading *position* is required to sync — see reader/sync/README.md).
 */
export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(load);

  useEffect(() => {
    writeJSON(STORAGE_KEY, settings);
  }, [settings]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, update };
}
