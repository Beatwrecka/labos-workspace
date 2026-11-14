/**
 * LabOS Workspace — brand surfaces.
 *
 * Scoped to the LabOS views on purpose. The briefing asks for *restrained*
 * orange accents, so these are the only styles that carry the brand colour;
 * AFFiNE's own chrome keeps its blue, and no upstream theme token is redefined.
 *
 * The accent is applied explicitly rather than through a theme variable because
 * the brand colour is LabOS's, not the user's: it must not move when the user
 * changes their accent preference. Every value comes from `brand.ts` — there is
 * no hex literal in this file — and `labos/scripts/branding.test.mjs` measures
 * them against the WCAG thresholds.
 *
 * Deliberately small: four styles, each of which is used. Nothing here is a
 * design system, and nothing is here "for later".
 */

import { style } from '@vanilla-extract/css';

import {
  LABOS_ACCENT_DARK,
  LABOS_ACCENT_LIGHT,
  LABOS_MARK_BACKGROUND_DARK,
  LABOS_MARK_BACKGROUND_LIGHT,
  LABOS_MARK_FOREGROUND_DARK,
  LABOS_MARK_FOREGROUND_LIGHT,
} from './brand';

/** Follow the app's own theme attribute, the convention used upstream. */
const onDark = (declarations: Record<string, string>) => ({
  '[data-theme="dark"] &': declarations,
});

/** The monogram: a rounded orange square with the initials in it. */
export const mark = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  borderRadius: '8px',
  backgroundColor: LABOS_MARK_BACKGROUND_LIGHT,
  color: LABOS_MARK_FOREGROUND_LIGHT,
  fontWeight: 700,
  letterSpacing: '0.02em',
  lineHeight: 1,
  userSelect: 'none',
  selectors: onDark({
    backgroundColor: LABOS_MARK_BACKGROUND_DARK,
    color: LABOS_MARK_FOREGROUND_DARK,
  }),
});

/** Mark and product name as one lockup. */
export const lockup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
});

/**
 * Two sizes only. The monogram is a stand-in, so a size scale would be
 * pretending to a system that does not exist yet.
 */
export const markMd = style({
  width: '28px',
  height: '28px',
  fontSize: '12px',
});

export const markSm = style({
  width: '20px',
  height: '20px',
  fontSize: '9px',
});

/** The product name, in the brand accent, inside a LabOS view. */
export const accentText = style({
  color: LABOS_ACCENT_LIGHT,
  selectors: onDark({ color: LABOS_ACCENT_DARK }),
});
