/**
 * LabOS Workspace — sprint, project gallery and shortlist styles.
 *
 * Built on the app's own theme tokens so it follows light/dark like every other
 * surface. Verification state is never communicated by colour alone: each badge
 * carries its own words, and the "not recorded" state is visually quieter than a
 * pass would be, which is the honest direction.
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
  gap: '12px',
  padding: '12px 20px',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  flexShrink: 0,
  flexWrap: 'wrap',
});

export const title = style({
  fontSize: cssVar('fontH4'),
  fontWeight: 700,
  margin: 0,
});

export const connectionBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  marginLeft: 'auto',
  flexWrap: 'wrap',
});

/** Connection state always carries text, never a lone coloured dot. */
export const connectionChip = styleVariants({
  connected: { color: cssVar('successColor'), fontWeight: 600 },
  disconnected: { color: cssVar('errorColor'), fontWeight: 600 },
  stale: { color: cssVar('warningColor'), fontWeight: 600 },
});

export const body = style({
  display: 'flex',
  flex: 1,
  minHeight: 0,
});

export const main = style({
  flex: 1,
  overflowY: 'auto',
  padding: '20px 24px 96px',
  minWidth: 0,
});

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  height: '100%',
  padding: '40px',
  color: cssVar('textSecondaryColor'),
  textAlign: 'center',
});

export const emptyTitle = style({
  fontSize: cssVar('fontH6'),
  fontWeight: 600,
  color: cssVar('textPrimaryColor'),
});

export const notice = style({
  padding: '10px 14px',
  borderRadius: '8px',
  backgroundColor: cssVar('backgroundWarningColor'),
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  margin: '0 0 16px',
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-start',
});

// --- sprint cards ---------------------------------------------------------------

export const cardList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  maxWidth: '960px',
});

export const card = style({
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '10px',
  backgroundColor: cssVar('backgroundPrimaryColor'),
  overflow: 'hidden',
});

export const cardHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '14px 16px',
  width: '100%',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
  ':hover': { backgroundColor: cssVar('hoverColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '-2px',
  },
});

export const cardHeading = style({
  flex: 1,
  minWidth: 0,
});

export const cardTitle = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 600,
  margin: '0 0 4px',
  wordBreak: 'break-word',
});

export const cardMeta = style({
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

export const cardGoal = style({
  margin: '6px 0 0',
  fontSize: cssVar('fontSm'),
  color: cssVar('textSecondaryColor'),
  wordBreak: 'break-word',
});

export const expandIndicator = style({
  flexShrink: 0,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
});

export const cardBody = style({
  padding: '0 16px 16px',
  borderTop: `1px solid ${cssVar('borderColor')}`,
});

/**
 * The four evidence dimensions, each in its own row and visually distinct.
 *
 * Deliberately a list rather than four icons: the reader has to be able to see
 * that "reported" and "independently reviewed" are different claims.
 */
export const evidenceGrid = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, max-content) 1fr',
  gap: '8px 16px',
  margin: '14px 0',
  alignItems: 'start',
});

export const evidenceLabelCell = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: cssVar('textSecondaryColor'),
  paddingTop: '2px',
});

export const evidenceValueCell = style({
  fontSize: cssVar('fontSm'),
  color: cssVar('textPrimaryColor'),
  wordBreak: 'break-word',
});

/** A badge is always accompanied by words, never colour alone. */
export const evidenceBadge = styleVariants({
  reported: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: cssVar('fontXs'),
    fontWeight: 600,
    border: `1px solid ${cssVar('borderColor')}`,
    backgroundColor: cssVar('backgroundSecondaryColor'),
    color: cssVar('textSecondaryColor'),
  },
  unrecorded: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: cssVar('fontXs'),
    fontWeight: 600,
    border: `1px dashed ${cssVar('borderColor')}`,
    color: cssVar('textSecondaryColor'),
  },
  recorded: {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: '999px',
    fontSize: cssVar('fontXs'),
    fontWeight: 600,
    border: `1px solid ${cssVar('borderColor')}`,
    backgroundColor: cssVar('backgroundSuccessColor'),
    color: cssVar('textPrimaryColor'),
  },
});

export const evidenceDetail = style({
  display: 'block',
  marginTop: '4px',
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.5,
});

export const gapList = style({
  margin: '12px 0 0',
  padding: '10px 12px',
  borderRadius: '8px',
  backgroundColor: cssVar('backgroundSecondaryColor'),
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  listStyle: 'none',
});

export const gapItem = style({
  display: 'flex',
  gap: '6px',
  margin: '0 0 4px',
  alignItems: 'flex-start',
});

export const needsYou = style({
  margin: '12px 0 0',
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${cssVar('warningColor')}`,
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
});

// --- project gallery ------------------------------------------------------------

export const galleryLayout = style({
  display: 'flex',
  gap: '24px',
  alignItems: 'flex-start',
});

export const gallery = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '16px',
  flex: 1,
  minWidth: 0,
});

export const projectCard = style({
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '10px',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
  padding: 0,
  ':hover': { borderColor: cssVar('primaryColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

/** A cover is dominated by the chosen screenshot; a placeholder says why. */
export const cover = style({
  aspectRatio: '16 / 9',
  width: '100%',
  objectFit: 'cover',
  display: 'block',
  backgroundColor: cssVar('backgroundSecondaryColor'),
  borderBottom: `1px solid ${cssVar('borderColor')}`,
});

export const coverPlaceholder = style({
  aspectRatio: '16 / 9',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '12px',
  backgroundColor: cssVar('backgroundSecondaryColor'),
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.5,
});

export const projectBody = style({
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  flex: 1,
});

export const projectName = style({
  fontSize: cssVar('fontBase'),
  fontWeight: 600,
  margin: 0,
  wordBreak: 'break-word',
});

export const projectSummary = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  margin: 0,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const projectMeta = style({
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  marginTop: 'auto',
});

export const statusChip = style({
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: '999px',
  border: `1px solid ${cssVar('borderColor')}`,
  fontSize: cssVar('fontXs'),
});

/** The shortlist sits to the right and collapses when space is tight. */
export const shortlist = style({
  width: '260px',
  flexShrink: 0,
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '10px',
  padding: '14px',
  '@media': {
    '(max-width: 1100px)': { display: 'none' },
  },
});

export const shortlistTitle = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: cssVar('textSecondaryColor'),
  margin: '0 0 10px',
});

export const shortlistItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 4px',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  fontSize: cssVar('fontSm'),
});

export const shortlistLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** Move controls are real buttons, so reordering works from the keyboard. */
export const moveButton = style({
  border: `1px solid ${cssVar('borderColor')}`,
  background: 'transparent',
  color: cssVar('textSecondaryColor'),
  borderRadius: '4px',
  width: '22px',
  height: '22px',
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
  ':hover': {
    backgroundColor: cssVar('hoverColor'),
    color: cssVar('textPrimaryColor'),
  },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '1px',
  },
  ':disabled': { opacity: 0.4, cursor: 'default' },
});

// --- project detail --------------------------------------------------------------

export const detail = style({
  maxWidth: '900px',
});

export const detailHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '16px',
  marginBottom: '20px',
  flexWrap: 'wrap',
});

export const detailTitle = style({
  fontSize: cssVar('fontH2'),
  fontWeight: 700,
  margin: '0 0 6px',
});

export const detailSection = style({
  margin: '0 0 24px',
});

export const detailSectionTitle = style({
  fontSize: cssVar('fontH6'),
  fontWeight: 600,
  margin: '0 0 8px',
});

export const detailText = style({
  fontSize: cssVar('fontSm'),
  color: cssVar('textPrimaryColor'),
  lineHeight: 1.6,
  margin: 0,
  whiteSpace: 'pre-wrap',
});

export const screenshotStrip = style({
  display: 'flex',
  gap: '10px',
  overflowX: 'auto',
  paddingBottom: '6px',
});

export const screenshot = style({
  width: '200px',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  borderRadius: '8px',
  border: `1px solid ${cssVar('borderColor')}`,
  flexShrink: 0,
});

export const screenshotPlaceholder = style({
  width: '200px',
  aspectRatio: '16 / 9',
  borderRadius: '8px',
  border: `1px dashed ${cssVar('borderColor')}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px',
  textAlign: 'center',
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  flexShrink: 0,
});

export const secondaryButton = style({
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
