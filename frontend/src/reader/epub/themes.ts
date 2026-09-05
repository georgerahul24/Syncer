import type Rendition from 'epubjs/types/rendition';
import type { ReaderSettings } from '../../types';

// epub.js themes are plain CSS injected into each chapter's iframe. These
// three intentionally do NOT reuse the app-chrome tokens in
// styles/variables.css — reading-content theme (section 32) is a
// user-chosen preference independent of the surrounding app/OS theme, and
// "sepia" in particular has no app-chrome equivalent.
const THEME_RULES = {
  light: { body: { background: '#ffffff', color: '#1c1c1e' } },
  sepia: { body: { background: '#f4ecd8', color: '#5b4636' } },
  dark: { body: { background: '#18181a', color: '#e8e8ea' } },
} as const;

const FONT_STACKS: Record<string, string> = {
  georgia: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
};

// Each Rendition owns its own Themes instance (`new Themes(rendition)`
// internally), so registration is cheap object bookkeeping done fresh per
// rendition — nothing here is process-global state.
export function registerThemes(rendition: Rendition): void {
  rendition.themes.register('light', THEME_RULES.light);
  rendition.themes.register('sepia', THEME_RULES.sepia);
  rendition.themes.register('dark', THEME_RULES.dark);
}

export function applyAppearance(rendition: Rendition, settings: ReaderSettings): void {
  rendition.themes.select(settings.theme);
  rendition.themes.font(FONT_STACKS[settings.fontFamily] ?? FONT_STACKS.georgia);
  rendition.themes.fontSize(`${settings.fontSize}px`);
  rendition.themes.override('line-height', String(settings.lineHeight));
  rendition.themes.override('padding-top', `${settings.padding.top}px`);
  rendition.themes.override('padding-right', `${settings.padding.right}px`);
  rendition.themes.override('padding-bottom', `${settings.padding.bottom}px`);
  rendition.themes.override('padding-left', `${settings.padding.left}px`);
}
