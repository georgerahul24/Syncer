/**
 * The app's icon set: thin monochrome strokes that take their colour from
 * `currentColor`, so a single set works on light and dark themes and against
 * the frosted top bar without any per-icon tuning.
 *
 * Deliberately not emoji. Emoji render in full colour from a font the app
 * doesn't control, so they change appearance between Android, macOS and the
 * browser, drag the eye away from the page, and can't be dimmed to match a
 * disabled button.
 */

const BASE = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export const IconBack = () => (
  <svg {...BASE}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const IconContents = () => (
  <svg {...BASE}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const IconSearch = () => (
  <svg {...BASE}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-3.6-3.6" />
  </svg>
);

export const IconAnnotate = () => (
  <svg {...BASE}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 6.5l3 3" />
  </svg>
);

export const IconType = () => (
  <svg {...BASE}>
    <path d="M4 18L9.5 6l5.5 12" />
    <path d="M6 14h7" />
    <path d="M17 18V11" />
    <path d="M20.5 18V13.5a2.5 2.5 0 0 0-3.5-2.3" />
  </svg>
);

export const IconExpand = () => (
  <svg {...BASE}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconCollapse = () => (
  <svg {...BASE}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
);

/** Not yet on the device — an arrow into a tray. */
export const IconDownload = () => (
  <svg {...BASE}>
    <path d="M12 4v10" />
    <path d="M8 10.5l4 4 4-4" />
    <path d="M4.5 18.5h15" />
  </svg>
);

/** Downloaded and available offline — the same tray, now with a check. */
export const IconDownloaded = () => (
  <svg {...BASE}>
    <path d="M8 9.5l3 3 5.5-5.5" />
    <path d="M4.5 18.5h15" />
    <path d="M12 15.5v-3" />
  </svg>
);

/** Transfer in progress — a ring the caller animates via CSS. */
export const IconDownloading = () => (
  <svg {...BASE}>
    <circle cx="12" cy="12" r="7.5" strokeOpacity="0.25" />
    <path d="M19.5 12a7.5 7.5 0 0 0-7.5-7.5" />
  </svg>
);

/** Re-fetch from the server. The caller spins it via CSS while a refresh is in flight. */
export const IconRefresh = () => (
  <svg {...BASE}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);
