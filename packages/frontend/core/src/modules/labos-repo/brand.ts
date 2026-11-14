/**
 * LabOS Workspace — brand constants, and the pure helpers derived from them.
 *
 * One place to read the product's name, mark and accent, so a rename or an
 * accent change cannot update half the product and leave the other half behind.
 *
 * The briefing asks for *light* branding: the LabOS name, a simple temporary
 * monogram and restrained orange accents with adequate contrast — explicitly
 * **not** a replacement of every upstream identifier, and not a new brand
 * system. So nothing here rewrites AFFiNE's own theme tokens and nothing
 * touches the upstream About/notices, which keep their attribution.
 *
 * Everything in this file is pure — no React, no DOM, no Electron — because the
 * contrast and title rules are the parts worth proving, and they can be proved
 * without a GUI (see `labos/scripts/branding.test.mjs`).
 */

export const LABOS_PRODUCT_NAME = 'LabOS Workspace';

/**
 * Temporary monogram. Two initials, so the mark still reads at 16px.
 * Deliberately a stand-in: the briefing allows a simple placeholder rather than
 * a designed identity.
 */
export const LABOS_MONOGRAM = 'LO';

/**
 * The mark is a filled square rather than an image: it stays crisp at any size
 * and needs no new asset pipeline.
 *
 * It follows the theme rather than using one fixed orange, and the reason is
 * worth stating because it is not obvious. An orange dark enough to carry white
 * initials sits at roughly 2.9:1 against a near-black canvas, so the square
 * would lose its edge in dark mode. An orange light enough to keep that edge
 * cannot carry white initials at all — white on it measures about 2.3:1. So:
 *
 *   light mode — a deep orange with white initials
 *   dark mode  — a light orange with near-black initials
 *
 * `branding.test.mjs` measures both pairs: the initials at 4.5:1 as text, and
 * the square at 3:1 against the canvas as a graphical object.
 */
export const LABOS_MARK_BACKGROUND_LIGHT = '#C2410C';
export const LABOS_MARK_FOREGROUND_LIGHT = '#FFFFFF';
export const LABOS_MARK_BACKGROUND_DARK = '#FB923C';
export const LABOS_MARK_FOREGROUND_DARK = '#1A1A1A';

/**
 * Accent used for text, icons and interactive affordances *inside the LabOS
 * views only*. Two values rather than one, because a single orange cannot pass
 * contrast on both a white and a near-black canvas.
 */
export const LABOS_ACCENT_LIGHT = '#C2410C';
export const LABOS_ACCENT_DARK = '#FB923C';

/**
 * The surfaces the accents are checked against. These are reference canvases,
 * not theme tokens: the app's light canvas is white/near-white and its dark
 * canvas is a near-black. `#FAFAFA` is the value the renderer already declares
 * as its `theme-color` meta, so it is the app's own statement about its light
 * canvas rather than a guess.
 *
 * Checking against a *range* of dark canvases rather than one exact token is
 * deliberate: it means the contrast claim does not silently depend on a token
 * value that a future upstream release may change.
 */
export const LABOS_REFERENCE_LIGHT_SURFACES = ['#FFFFFF', '#FAFAFA'];
export const LABOS_REFERENCE_DARK_SURFACES = ['#000000', '#1A1A1A', '#262626'];

/** WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for graphical objects and UI. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_GRAPHIC_CONTRAST = 3;

export type LabosTheme = 'light' | 'dark';

/**
 * Is this the LabOS build?
 *
 * The renderer learns its build type through the preload, which exposes the URL
 * scheme: `labos` for a packaged LabOS build, `labos-dev` in development, and
 * the `affine*` schemes for every upstream release type. Deriving the answer
 * from the scheme keeps a single source of truth for "which product am I?" and
 * means an upstream build made from this fork keeps upstream behaviour.
 */
export function isLabosScheme(scheme: string | null | undefined): boolean {
  if (typeof scheme !== 'string') return false;
  return scheme === 'labos' || scheme.startsWith('labos-');
}

/** The accent to use on a given theme. Unknown input falls back to light. */
export function labosAccent(theme: LabosTheme): string {
  return theme === 'dark' ? LABOS_ACCENT_DARK : LABOS_ACCENT_LIGHT;
}

/** The monogram's colours on a given theme. */
export function labosMarkColors(theme: LabosTheme): {
  background: string;
  foreground: string;
} {
  return theme === 'dark'
    ? {
        background: LABOS_MARK_BACKGROUND_DARK,
        foreground: LABOS_MARK_FOREGROUND_DARK,
      }
    : {
        background: LABOS_MARK_BACKGROUND_LIGHT,
        foreground: LABOS_MARK_FOREGROUND_LIGHT,
      };
}

/**
 * The window title.
 *
 * Kept as a pure function because the title is a branding surface that is easy
 * to get subtly wrong — a stray `AFFiNE` here is exactly the kind of string the
 * briefing says should not remain, and a blank title makes the window
 * unfindable in the Dock and the window switcher.
 */
export function formatDocumentTitle({
  viewTitle,
  notificationCount = 0,
  productName = LABOS_PRODUCT_NAME,
}: {
  viewTitle?: string | null;
  notificationCount?: number;
  productName?: string;
} = {}): string {
  const trimmed = typeof viewTitle === 'string' ? viewTitle.trim() : '';
  const count =
    Number.isFinite(notificationCount) && notificationCount > 0
      ? Math.floor(notificationCount)
      : 0;
  const prefix = count > 0 ? `(${count}) ` : '';
  return prefix + (trimmed ? `${trimmed} · ${productName}` : productName);
}

/** Parse `#rgb` or `#rrggbb` into 0–255 channels. Throws on anything else. */
function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map(ch => ch + ch)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channel => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, always ≥ 1, order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
