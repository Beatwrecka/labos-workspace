/**
 * LabOS Workspace — the temporary monogram mark.
 *
 * Two initials in a rounded orange square. Drawn in CSS rather than shipped as
 * an image so it stays crisp at any size, needs no asset pipeline, and cannot
 * drift out of step with the accent in `brand.ts`.
 *
 * Accessibility: the mark is decorative whenever the product name sits beside
 * it, so it is hidden from screen readers by default. Pass `label` when the mark
 * stands alone, and it becomes a labelled image instead — the name is then
 * announced rather than a bare "LO".
 */

import { LABOS_MONOGRAM, LABOS_PRODUCT_NAME } from './brand';
import * as s from './brand.css';

export function LabosMark({
  size = 'md',
  label,
}: {
  size?: 'sm' | 'md';
  label?: string;
}) {
  const sizeClass = size === 'sm' ? s.markSm : s.markMd;
  return (
    <span
      className={`${s.mark} ${sizeClass}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {LABOS_MONOGRAM}
    </span>
  );
}

/** Mark and product name as one lockup, for a page header. */
export function LabosLockup({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={s.lockup}>
      <LabosMark size={size} />
      {/*
        The name carries the accent. That is the restrained use the briefing
        asks for: the brand colour on one piece of text inside the LabOS views,
        not a repainted interface. `branding.test.mjs` holds this text to 4.5:1
        against the light canvas and against a range of dark ones.
      */}
      <span className={s.accentText}>{LABOS_PRODUCT_NAME}</span>
    </span>
  );
}
