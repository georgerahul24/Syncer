# UI Handoff: "Paper and Ink"

This file explains how to rebuild the Syncer look and feel in any new project.
It covers the idea behind the design, the exact tokens, the layout, the
components and the motion. Copy the tokens as they are, then follow the rules.

Source of truth in this repo: `frontend/src/styles/variables.css` and
`frontend/src/styles/global.css`. Component styles live in `*.module.css`
next to each component.

---

## 1. The idea in one line

A calm reading room. Warm paper, dark ink, one quiet green. Solid surfaces,
short soft shadows, small fast motion. Nothing glows, nothing blurs, nothing
bounces.

### Core rules

1. **Solid surfaces only.** No `backdrop-filter`, no glass, no fixed gradient
   backgrounds. Blur over scrolling content costs a frame on every scroll.
2. **Depth from tone, not effects.** Paper has a few tones (bg, surface,
   raised, sunken). Use a tone step first, a hairline border second, a
   shadow last.
3. **Ink for actions, green for meaning.** Main buttons are dark ink pills.
   The green accent is only for progress, focus, "you are here" and
   "release now". If everything is green, nothing is.
4. **Serif for voice, sans for work.** Brand, page titles, section titles,
   book titles and big numbers use the serif. Everything you read quickly
   or tap (buttons, labels, menus, body UI) uses the system sans.
5. **System fonts only.** No web fonts. The app must load fast and work
   offline.
6. **Motion uses transform and opacity only.** Never animate width, height,
   top, left, box-shadow or filter.
7. **Every animation is short.** 120 to 320 ms. One easing curve for almost
   everything.
8. **Hover effects only on devices that can hover.** Wrap them in
   `@media (hover: hover)`. Touch screens get press feedback instead.
9. **Light and dark are both first class.** Same tokens, swapped values,
   via `prefers-color-scheme`.
10. **Respect reduced motion.** One global rule turns all motion off.

---

## 2. Tokens (copy this whole block)

```css
:root {
  color-scheme: light;

  /* Paper tones, lightest on top */
  --color-bg: #f5f2ec;
  --color-surface: #fbfaf7;
  --color-surface-raised: #ffffff;
  --color-sunken: #ebe6dd;
  --color-cover: #e6e0d4;            /* blank "board", e.g. empty cover */
  --color-hover: rgba(60, 45, 20, 0.06);

  /* Ink */
  --color-text: #1f1c18;
  --color-text-secondary: #625b51;
  --color-text-tertiary: #857d71;
  --color-border: rgba(60, 45, 20, 0.11);
  --color-border-strong: rgba(60, 45, 20, 0.2);
  --color-ink: #1f1c18;              /* primary button fill */
  --color-ink-contrast: #fbfaf7;

  /* Clothbound green, used sparingly */
  --color-accent: #2e6a4f;
  --color-accent-contrast: #ffffff;
  --color-accent-soft: rgba(46, 106, 79, 0.12);

  /* Status */
  --color-danger: #b3261e;
  --color-danger-soft: rgba(179, 38, 30, 0.09);
  --color-warning: #a86a00;
  --color-success: #3f9a6c;

  /* Radii */
  --radius-xs: 4px;   /* book covers, tiny chips */
  --radius-sm: 6px;   /* menu rows, focus ring */
  --radius-md: 10px;  /* inputs, list items */
  --radius-lg: 14px;  /* menus, popovers, banners */
  --radius-xl: 20px;  /* dialogs, big cards */
  --radius-full: 999px; /* buttons, pills, toasts */

  /* Shadows: warm-tinted, offset + soft blur, never animated */
  --shadow-sm: 0 1px 2px rgba(50, 35, 15, 0.08);
  --shadow-md: 0 2px 4px rgba(50, 35, 15, 0.05), 0 10px 24px -6px rgba(50, 35, 15, 0.16);
  --shadow-lg: 0 4px 8px rgba(50, 35, 15, 0.06), 0 24px 48px -12px rgba(50, 35, 15, 0.24);
  --shadow-cover: 0 1px 1px rgba(50, 35, 15, 0.1), 0 8px 16px -8px rgba(50, 35, 15, 0.35);

  /* Type */
  --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  --font-serif: 'Iowan Old Style', 'Charter', 'Bitstream Charter', 'Palatino Linotype',
    Palatino, Georgia, 'Noto Serif', serif;

  /* Fixed rem scale, ratio about 1.2. Not fluid: this is product UI. */
  --text-2xs: 0.6875rem; /* 11px */
  --text-xs: 0.75rem;    /* 12px */
  --text-sm: 0.8125rem;  /* 13px */
  --text-base: 0.9375rem;/* 15px, body */
  --text-md: 1.0625rem;  /* 17px */
  --text-lg: 1.3125rem;  /* 21px, section titles, brand */
  --text-xl: 1.625rem;   /* 26px */
  --text-2xl: 2rem;      /* 32px, big stats */

  /* Spacing: 4px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  --gutter: 32px; /* page side padding; 16px on phones */

  /* Motion */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --duration-fast: 140ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --transition-fast: var(--duration-fast) var(--ease-out);
  --transition-medium: var(--duration-base) var(--ease-out);
  --transition-spring: var(--duration-slow) var(--ease-out); /* side panels */

  --focus-ring: 0 0 0 3px var(--color-accent-soft);
}

@media (max-width: 640px) {
  :root { --gutter: 16px; }
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --color-bg: #151412;
    --color-surface: #1d1b19;
    --color-surface-raised: #2a2724;
    --color-sunken: rgba(255, 240, 215, 0.07); /* in dark, "inset" is LIGHTER */
    --color-cover: #2b2825;
    --color-hover: rgba(255, 240, 215, 0.06);
    --color-text: #ede8e0;
    --color-text-secondary: #aaa296;
    --color-text-tertiary: #7f786e;
    --color-border: rgba(255, 240, 215, 0.09);
    --color-border-strong: rgba(255, 240, 215, 0.17);
    --color-ink: #ede8e0;          /* primary buttons flip to light pills */
    --color-ink-contrast: #151412;
    --color-accent: #7cc4a0;
    --color-accent-contrast: #0f1a14;
    --color-accent-soft: rgba(124, 196, 160, 0.16);
    --color-danger: #ff8a80;
    --color-danger-soft: rgba(255, 138, 128, 0.12);
    --color-warning: #f0b44c;
    --color-success: #6fcf97;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-md: 0 2px 4px rgba(0, 0, 0, 0.3), 0 12px 28px -6px rgba(0, 0, 0, 0.55);
    --shadow-lg: 0 4px 8px rgba(0, 0, 0, 0.3), 0 24px 56px -12px rgba(0, 0, 0, 0.7);
    --shadow-cover: 0 1px 1px rgba(0, 0, 0, 0.4), 0 10px 18px -8px rgba(0, 0, 0, 0.7);
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Dark mode notes

- Backgrounds are warm charcoal, never pure black or blue-grey.
- Text is warm off-white, never pure white.
- Borders and hover fills are a warm cream at low opacity.
- Shadows get much darker so cards still lift off the page.

---

## 3. Global base (copy this too)

```css
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--color-bg);       /* flat, never a gradient */
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
  overflow-wrap: break-word;
  caret-color: var(--color-accent);
  accent-color: var(--color-accent);  /* native checkboxes, ranges */
}

img { max-width: 100%; display: block; }
button, input, textarea, select { font: inherit; color: inherit; }
input::placeholder, textarea::placeholder { color: var(--color-text-tertiary); }

button {
  background: none; border: none; padding: 0; cursor: pointer;
  transition: transform 120ms var(--ease-out);
  touch-action: manipulation;
}
button:active { transform: scale(0.97); }   /* one shared press feel */
button:disabled { cursor: default; }

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

::selection { background: color-mix(in srgb, var(--color-accent) 24%, transparent); }

/* Thin warm scrollbars */
* { scrollbar-width: thin; scrollbar-color: var(--color-border-strong) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 10px; border: 3px solid transparent; background-clip: content-box;
}

/* Shared entrance animations for things that mount to show */
@keyframes fadeIn { from { opacity: 0; } }
@keyframes riseIn { from { opacity: 0; transform: translateY(8px) scale(0.985); } }
@keyframes popIn  { from { opacity: 0; transform: scale(0.96); } }
```

---

## 4. Typography rules

| Use | Font | Size | Weight | Extra |
|---|---|---|---|---|
| Brand / app name | serif | `--text-lg` | 600 | `letter-spacing: -0.01em; line-height: 1` |
| Section title | serif | `--text-lg` | 600 | `letter-spacing: -0.01em; line-height: 1.2; text-wrap: balance` |
| Panel / dialog title | serif | `--text-md` | 600 | |
| Item title (card, book) | serif | `--text-sm` to `--text-base` | 600 | clamp to 2 lines |
| Big stat number | serif | `--text-2xl` | 600 | `font-variant-numeric: tabular-nums` |
| Empty state headline | serif | `--text-xl` | 400 | `line-height: 1.25` |
| Body UI | sans | `--text-base` | 400 | `line-height: 1.5` |
| Buttons | sans | `--text-sm` | 600 | |
| Labels, meta, captions | sans | `--text-xs` | 400-500 | `--color-text-secondary` |
| Tiny group labels | serif italic | `--text-xs` | 400 | `--color-text-tertiary` |

- Any number that changes live (percent, upload %, counts) uses
  `font-variant-numeric: tabular-nums` so it doesn't jitter.
- Use three text colors only: `--color-text`, `--color-text-secondary`,
  `--color-text-tertiary`.

---

## 5. Layout

### Page shell

```css
.page {
  max-width: 1320px;
  margin: 0 auto;
  min-height: 100%;
  padding: 0 calc(var(--gutter) + env(safe-area-inset-right))
           calc(var(--space-8) + env(safe-area-inset-bottom))
           calc(var(--gutter) + env(safe-area-inset-left));
}
```

### Sticky top bar

- Height at least 64px. Solid `--color-bg` background. One hairline
  `border-bottom: 1px solid var(--color-border)`. No blur, no translucency.
- It bleeds edge to edge with negative margins equal to the gutter.
- Left: brand in serif. Middle: a rounded search field (pill shape, sunken
  fill). Right: icon buttons (36px circles), the primary pill button, and an
  avatar circle with a serif initial.
- Add `env(safe-area-inset-top)` to the top padding.

### Desktop body

- Two columns: a 200px sticky sidebar (`top: 72px`) and a flexible content
  column, gap `--space-7` (48px).
- Content is a stack of sections. First section `margin-top: 32px`, each
  following section `48px`.

### Phone body (640px and below)

- Gutter drops to 16px.
- The search field moves to its own full-width row under the brand.
- The sidebar becomes one horizontal, scrolling row of filter chips (pills).
  The active chip is filled with ink.
- Shelves scroll sideways edge to edge with `scroll-snap-type: x proximity`.

### Shelves and grids

```css
.row {               /* horizontal shelf */
  display: flex; gap: var(--space-5);
  overflow-x: auto; overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  padding: 6px 0 var(--space-3); margin-top: -6px; /* room for hover lift */
}
.row > * { flex: 0 0 148px; scroll-snap-align: start; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: var(--space-6) var(--space-5);
}
```

### Full-screen "focus" views (like the reader)

- The content owns the whole screen. Chrome (top bar, progress) is hidden
  by default.
- A small handle at the top center brings the chrome back. It hides again
  after 5 idle seconds.
- Interacting with visible chrome keeps it alive, but general activity
  (scrolling, tapping the content) never summons it.

---

## 6. Components

### Primary button (ink pill)

```css
.primary {
  height: 36px;            /* 44px for big empty-state CTAs */
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-ink);
  color: var(--color-ink-contrast);
  font-size: var(--text-sm); font-weight: 600;
  white-space: nowrap; font-variant-numeric: tabular-nums;
  transition: opacity var(--transition-fast), transform 120ms var(--ease-out);
}
@media (hover: hover) { .primary:hover:not(:disabled) { opacity: 0.86; } }
.primary:disabled { opacity: 0.55; }
```

### Secondary button (outline pill)

`height: 40px`, `border: 1px solid var(--color-border-strong)`, transparent
fill, `--color-text`, hover fill `--color-hover`.

### Tertiary / text button

No border, `--color-text-secondary`, hover fill `--color-hover`.

### Icon button

```css
.icon {
  width: 36px; height: 36px; border-radius: 50%;   /* 38px in toolbars */
  display: flex; align-items: center; justify-content: center;
  color: var(--color-text-secondary);
  transition: color var(--transition-fast), background-color var(--transition-fast),
              transform 120ms var(--ease-out);
}
@media (hover: hover) { .icon:hover { color: var(--color-text); background: var(--color-hover); } }
.icon:active { transform: scale(0.92); background: var(--color-hover); }
```

Icons are simple line SVGs, 20px, `stroke: currentColor`, stroke width 1.7,
round caps and joins. No emoji in the UI.

### Card (physical object, e.g. book cover)

```css
.coverWrap {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-xs);
  background: var(--color-cover);
  box-shadow: var(--shadow-cover);          /* static, never animated */
  transition: transform 260ms var(--ease-out);
}
/* Painted spine fold on the left edge, plus a 1px inner edge */
.coverWrap::after {
  content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(0,0,0,.14) 0, rgba(255,255,255,.12) 2px,
              rgba(0,0,0,.04) 6px, transparent 12px);
  box-shadow: inset 0 0 0 1px rgba(40, 30, 15, 0.1);
}
@media (hover: hover) { .card:hover .coverWrap { transform: translateY(-4px); z-index: 3; } }
.coverWrap:active { transform: translateY(-1px) scale(0.985); }
```

- Progress shows as a 3px bar along the card's bottom edge, filled with the
  accent.
- With no artwork, show a "title page": cream paper (`#fbf8f1`), the title
  in serif, centered, clamped to 4 lines. Never a blank box or an emoji.
- A small round "more" button (28px, dark translucent, white glyph) sits
  top-right. Hidden until hover on desktop, always visible on touch.
- Under the cover: title (serif, 600, 2 lines max), then meta in
  `--text-xs` secondary, e.g. "35% · 7 minutes ago".

### Menus and popovers

```css
.menu {
  position: absolute; top: calc(100% + 8px); right: 0;
  min-width: 240px; padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  transform-origin: top right;          /* grow from the trigger */
  animation: popIn 180ms var(--ease-out);
}
.menuItem {
  display: block; width: 100%; text-align: left;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm); font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.menuItem:active { transform: none; }    /* rows don't shrink */
@media (hover: hover) { .menuItem:hover { background: var(--color-hover); } }
```

A menu header (like the signed-in email) is `--text-xs` secondary with a
hairline under it.

### Dialogs

- Backdrop: solid tint `color-mix(in srgb, var(--color-bg) 82%, transparent)`
  or a dark scrim, with `fadeIn 180ms`. No blur.
- Panel: `--color-surface-raised`, `--radius-xl`, `--shadow-lg`, enters with
  `riseIn 240ms`.
- Exit is an instant unmount. That's fine, and it keeps the code simple.

### Side panels (table of contents, notes, settings)

```css
.panel {
  position: fixed; top: 0; left: 0; bottom: 0;
  width: 320px; max-width: 86vw;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  transform: translateX(-100%); visibility: hidden;
  transition: transform var(--transition-spring), visibility 0s linear var(--duration-slow);
}
.panelOpen {
  transform: translateX(0); visibility: visible;
  transition: transform var(--transition-spring), visibility 0s;
}
```

Panels stay mounted and slide, so they animate both ways. The header has a
serif title and a 36px round close button. Lists inside use
`overscroll-behavior: contain`.

### Floating toolbar (hide/show chrome)

- Fixed to the top, `--color-surface` fill, hairline bottom border, plus one
  soft shadow `0 6px 16px -12px rgba(40,30,15,.35)`.
- Hidden state: `opacity: 0; transform: translateY(-100%); pointer-events: none`.
- Transition: opacity and transform, `--duration-base`, `--ease-out`.
- Title in the middle in serif, ellipsized.
- Status pill: 28px tall, sunken fill, a 7px colored dot (success, warning,
  tertiary for paused) and a short label. On phones, show only the dot.

### Toast

Ink pill, centered at the bottom, `bottom: 24px + safe-area`, `--shadow-lg`,
`--text-sm` weight 500. Enters with a translateY(8px) fade, 200ms. Auto-hides
after about 2.6s.

### Progress bars

3px tall, track `--color-border`, fill `--color-accent`, fully rounded. Pair
with a tabular-nums percent label in `--text-xs` secondary.

### Inputs

Pill or `--radius-md` shape, `--color-sunken` fill, no border at rest. On
focus: `box-shadow: var(--focus-ring)` plus a stronger border. Placeholder in
tertiary.

### Empty states

Centered, `max-width: 36ch`. One serif headline at `--text-xl`, one line of
secondary text, one 44px ink pill CTA. Example: "Your library is empty." /
"Add your first book".

### Loading and error states

- Prefer showing cached content at once and refreshing quietly, over a
  spinner.
- If you must wait, show centered secondary text ("Opening book…") and,
  for long waits, a thin 3px progress bar with a percent.
- Errors say what happened and what to do, in plain words, with one primary
  action ("Try again") and one quiet text action ("Back to library").
- A busy icon spins at `900ms linear infinite`. Under reduced motion it
  stops and dims to 55% opacity.

### Drag-and-drop target

A full-window solid tint (`--color-bg` at 82%) with a centered card: dashed
1.5px accent border, `--radius-xl`, accent serif text "Drop to upload",
entering with `popIn 220ms`.

---

## 7. Motion catalogue

| What | Animation | Duration | Easing |
|---|---|---|---|
| Any button press | `scale(0.97)` (icon buttons `0.92`) | 120ms | `--ease-out` |
| Hover color/fill | background-color, color | 140ms | `--ease-out` |
| Card hover lift | `translateY(-4px)` | 260ms | `--ease-out` |
| Card press | `translateY(-1px) scale(0.985)` | 260ms | `--ease-out` |
| Card "opening" beat | `translateY(-6px) scale(1.04)` then navigate | 150ms | `--ease-out` |
| Full-screen view enters | from `opacity 0, scale(.985), translateY(6px)` | 320ms | `--ease-out` |
| Menu / popover in | `popIn` (scale .96 → 1, fade) from trigger corner | 160-180ms | `--ease-out` |
| Dialog in | `riseIn` (8px up, scale .985 → 1, fade) | 240ms | `--ease-out` |
| Backdrop in | `fadeIn` | 180ms | `--ease-out` |
| Side panel | `translateX(-100%)` ↔ `0` | 300ms | `--ease-out` |
| Toolbar show/hide | fade + `translateY(-100%)` | 200ms | `--ease-out` |
| Toast in | fade + 8px rise | 200ms | `--ease-out` |
| Page turn (paginated) | slide in from the turn direction 28px + fade | 260ms | `cubic-bezier(0.16,1,0.3,1)` |
| Busy spinner | `rotate(360deg)` | 900ms | linear, infinite |
| Attention handle pulse | gentle opacity pulse | 1.4s | ease-in-out, infinite |

### Gesture: "pull past the edge" (rubber band)

Used to move to the next or previous chapter in scrolling mode. Reuse it for
any "pull to go further" action.

- It only starts if the gesture **starts** with the content already resting
  at the edge. Scrolling into the edge in the same gesture never counts.
- Content follows the finger with damping:
  `pull = 120 * (1 - exp(-raw / 120))`, so it tightens like a band.
- It commits only after a clear 150px of raw finger travel. For a mouse or
  trackpad, after 420px of wheel delta in a fresh gesture (220ms quiet gap
  first).
- A small pill hint near the edge fades in with the pull: "Keep pulling for
  next chapter". It turns accent-green with "Release for next chapter" once
  the pull is far enough.
- On release short of the threshold, it springs back over 280ms.
- On commit, the old content slides out 36px in 130ms. The new content is
  hidden until its layout settles, then slides in from 48px and fades over
  320ms.

### Motion rules

- Animate only `transform` and `opacity`.
- Never transition `box-shadow`, `filter`, `width`, `height`, `top` or `left`.
  If a bar width must change, set it directly, or use `transform: scaleX()`.
- No `transition: all`.
- Enter animations should feel like they come *from* something: popovers from
  their trigger corner, panels from their edge, pages from slightly below.
- Exits can be instant. Speed beats choreography.

---

## 8. Performance rules that are part of the design

These rules are why the app feels smooth. Keep them.

- No `backdrop-filter` on anything that sits over scrolling content.
- No `background-attachment: fixed`.
- No `mix-blend-mode` over scrolling content. It recomposites every frame.
- Large lists: memoize items and pass stable props (shared empty arrays,
  stable callbacks), so a scroll doesn't re-render every row.
- Scroll handlers do as little as possible: batch with
  `requestAnimationFrame`, and do expensive work after scrolling stops, in
  `requestIdleCallback`.
- Sticky and fixed bars are solid colors.
- Hover lifts use transform on a layer with a static shadow.

---

## 9. Responsiveness and platform details

- One breakpoint does most of the work: `max-width: 640px`.
- Always add `env(safe-area-inset-*)` to fixed bars, panels, toasts and
  bottom rows. Needs `viewport-fit=cover` in the viewport meta.
- Tap targets are at least 36px (44px for main CTAs).
- Hover-only UI (like the card "more" button) must be always visible on
  touch: `@media (hover: none) { opacity: 1 }`.
- Add `overscroll-behavior: contain` on inner scrollers, so the page behind
  doesn't move and pull-to-refresh doesn't fire.
- Provide separate light and dark `theme-color` meta tags:
  `<meta name="theme-color" content="#f5f2ec" media="(prefers-color-scheme: light)">`
  and `content="#151412"` for dark.

---

## 10. Voice and copy

- Plain, short and calm. "Add book", "Library up to date", "Opening book…".
- Errors explain the real cause and the next step. Never "Something went
  wrong" when we know more.
- Sentence case everywhere. Title Case only for section titles
  ("Continue Reading").
- Use the ellipsis character "…" for things in progress.

---

## 11. Quick checklist for a new project

1. Paste the tokens (section 2) and the global base (section 3).
2. Build a sticky solid top bar with a serif brand and ink pill CTA.
3. Use serif for titles, sans for everything else. No web fonts.
4. Make main actions ink pills. Keep green for progress, focus and "now".
5. Give every surface a solid tone. Lift with `--shadow-md` or `--shadow-lg`
   only on things that float (menus, dialogs, toasts).
6. Use `popIn` for menus, `riseIn` for dialogs, sliding transforms for
   panels.
7. Wrap hovers in `@media (hover: hover)`. Add press scale on everything
   tappable.
8. Check 360px width, dark mode and reduced motion before calling it done.
