import type Rendition from 'epubjs/types/rendition';
import type { ReaderSettings } from '../../types';

// epub.js themes are plain CSS injected into each chapter's iframe. These
// three intentionally do NOT reuse the app-chrome tokens in
// styles/variables.css — reading-content theme (section 32) is a
// user-chosen preference independent of the surrounding app/OS theme, and
// "sepia" in particular has no app-chrome equivalent.

// Book CSS routinely pins body text to an absolute size (`p { font-size:
// 11pt }`), which beats anything inherited from <body> and made the font-size
// control do nothing at all on those books. Normalising body text back to
// "inherit" is what makes the control authoritative — and `!important`,
// because the book's own rule usually has the higher specificity.
//
// Headings are deliberately left out: they're the one place a book's relative
// sizing is carrying real structure, and flattening them would turn a chapter
// title into a paragraph. The cost of the rest is that a book's intentionally
// smaller footnotes or captions come out at body size. That's the right trade
// for a reader-controlled size: a control that always works beats one that
// preserves incidental typography and silently does nothing half the time.
const TEXT_ELEMENTS = 'p, li, dd, dt, td, th, blockquote, div, span, section, article, figcaption';

function rulesFor(body: Record<string, string>) {
  return {
    body,
    [TEXT_ELEMENTS]: { 'font-size': 'inherit !important' },
  };
}

const THEME_RULES = {
  light: rulesFor({ background: '#ffffff', color: '#1c1c1e' }),
  sepia: rulesFor({ background: '#f4ecd8', color: '#5b4636' }),
  dark: rulesFor({ background: '#18181a', color: '#e8e8ea' }),
};

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

/**
 * Selects the reading theme.
 *
 * Kept apart from the typography below, and called ONLY when the theme
 * actually changes, because it is not idempotent: `themes.select()` ends up in
 * `Contents.addStylesheetRules`, which `insertRule`s into a <style> node it
 * never clears. Calling it on every appearance change appended another copy of
 * the theme's rules each time — so dragging a slider (which commits once per
 * animation frame) would pile hundreds of duplicate rules into the chapter's
 * stylesheet. Typography below writes inline styles instead, which are
 * idempotent and safe to re-apply as often as we like.
 */
export function applyTheme(rendition: Rendition, settings: ReaderSettings): void {
  rendition.themes.select(settings.theme);
}

/**
 * Applies font and spacing to a rendition.
 *
 * Note what is NOT here: reading padding. It used to be four
 * `themes.override('padding-*')` calls, and that could never have worked.
 * Those write to the iframe body's inline style — the exact same inline
 * style epub.js's own layout writes to. `Layout.format()` calls
 * `Contents.columns()` in paginated mode, which sets `padding-left`/`right`
 * with `!important` (so our value lost outright), and `Contents.size()` in
 * scrolled mode, which sets the `padding` *shorthand* (so our value was
 * erased on all four sides at once).
 *
 * Worse, `format()` re-runs on every content resize — and changing padding,
 * font size or line height *is* a content resize. So each change applied,
 * triggered a reflow, and was immediately overwritten by the reflow it
 * caused: the padding visibly flickered in and snapped back, every time.
 *
 * Padding now lives on the container element outside the iframe (see
 * EpubReader), which epub.js measures but never writes to. That also makes
 * it correct rather than merely persistent: epub.js sees the real reading
 * width, so its column and CFI maths agree with what's on screen.
 */
export function applyTypography(rendition: Rendition, settings: ReaderSettings): void {
  rendition.themes.font(FONT_STACKS[settings.fontFamily] ?? FONT_STACKS.georgia);
  // `themes.fontSize()` is deliberately bypassed: it forwards to
  // `override('font-size', size)` with no priority, which loses to any book
  // stylesheet that sets a size on <body>. Same reasoning for line-height.
  rendition.themes.override('font-size', `${settings.fontSize}px`, true);
  rendition.themes.override('line-height', String(settings.lineHeight), true);
}
