/**
 * LabOS Workspace — home screen styles.
 *
 * Calm and light, matching the app's own theme tokens. The layout is a single
 * column of sections so the reader scans top-to-bottom in order of usefulness,
 * rather than a dashboard grid of equally-weighted tiles.
 */

import { cssVar } from '@toeverything/theme';
import { style, styleVariants } from '@vanilla-extract/css';

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  overflow: 'hidden',
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '16px 24px',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  flexShrink: 0,
  flexWrap: 'wrap',
});

export const title = style({
  fontSize: cssVar('fontH4'),
  fontWeight: 700,
  margin: 0,
});

export const headerActions = style({
  display: 'flex',
  gap: '8px',
  marginLeft: 'auto',
});

export const linkButton = style({
  border: `1px solid ${cssVar('borderColor')}`,
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  borderRadius: '6px',
  padding: '6px 12px',
  fontSize: cssVar('fontSm'),
  cursor: 'pointer',
  ':hover': { backgroundColor: cssVar('hoverColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

export const body = style({
  flex: 1,
  overflowY: 'auto',
  padding: '20px 24px 96px',
});

export const section = style({
  maxWidth: '900px',
  margin: '0 0 28px',
});

export const sectionTitle = style({
  fontSize: cssVar('fontH6'),
  fontWeight: 600,
  margin: '0 0 10px',
  color: cssVar('textPrimaryColor'),
});

/** Continue-writing is the single most useful action, so it gets the most weight. */
export const continueCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  width: '100%',
  maxWidth: '560px',
  textAlign: 'left',
  padding: '14px 16px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '10px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  ':hover': { borderColor: cssVar('primaryColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

export const continuePath = style({
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  wordBreak: 'break-word',
});

export const continueMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const projectRow = style({
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
});

export const projectChip = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: '220px',
  padding: '12px 14px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '10px',
});

export const projectChipName = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 600,
  margin: 0,
  wordBreak: 'break-word',
});

export const projectChipSummary = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  margin: 0,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const changeList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
});

export const changeRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  padding: '10px 12px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '8px',
});

export const changeHeading = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '10px',
  justifyContent: 'space-between',
});

export const changeTitle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  wordBreak: 'break-word',
});

export const changeWhen = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

/** Provenance is a visible chip, so reported never reads as verified. */
export const provenanceChip = style({
  alignSelf: 'flex-start',
  marginTop: '4px',
  padding: '1px 8px',
  borderRadius: '999px',
  border: `1px dashed ${cssVar('borderColor')}`,
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const blockerList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
});

export const blockerRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  padding: '10px 12px',
  border: `1px solid ${cssVar('warningColor')}`,
  borderRadius: '8px',
});

export const blockerHeading = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '10px',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
});

export const blockerTitle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 700,
  wordBreak: 'break-word',
});

/** Attributable: the reader can see which source claims this. */
export const blockerSource = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  whiteSpace: 'nowrap',
});

export const badge = styleVariants({
  neutral: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    border: `1px solid ${cssVar('borderColor')}`,
    fontSize: cssVar('fontXs'),
    color: cssVar('textSecondaryColor'),
  },
});

export const s = {
  page,
  header,
  title,
  headerActions,
  linkButton,
  body,
  section,
  sectionTitle,
  continueCard,
  continuePath,
  continueMeta,
  projectRow,
  projectChip,
  projectChipName,
  projectChipSummary,
  changeList,
  changeRow,
  changeHeading,
  changeTitle,
  changeWhen,
  provenanceChip,
  blockerList,
  blockerRow,
  blockerHeading,
  blockerTitle,
  blockerSource,
  badge,
};
