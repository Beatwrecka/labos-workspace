/**
 * LabOS Workspace — repository document UI styles.
 *
 * Built on the application's own theme variables rather than hard-coded colours,
 * so the view follows light/dark and the accent colour like every other surface.
 * No `!important`, and nothing that depends on a specific upstream class name.
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

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 16px',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  flexShrink: 0,
  flexWrap: 'wrap',
});

export const breadcrumb = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: cssVar('fontSm'),
  color: cssVar('textSecondaryColor'),
  minWidth: 0,
  flex: 1,
});

export const breadcrumbRoot = style({
  fontWeight: 600,
  color: cssVar('textPrimaryColor'),
  whiteSpace: 'nowrap',
});

export const breadcrumbSeparator = style({
  color: cssVar('textDisableColor'),
});

export const breadcrumbPath = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  direction: 'rtl',
  textAlign: 'left',
});

/** The "file-backed" badge. Shape and text both carry the meaning. */
export const fileBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  border: `1px solid ${cssVar('borderColor')}`,
  color: cssVar('textSecondaryColor'),
  backgroundColor: cssVar('backgroundSecondaryColor'),
  whiteSpace: 'nowrap',
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0,
});

export const body = style({
  display: 'flex',
  flex: 1,
  minHeight: 0,
});

export const toc = style({
  width: '220px',
  flexShrink: 0,
  borderRight: `1px solid ${cssVar('borderColor')}`,
  padding: '16px 12px',
  overflowY: 'auto',
  '@media': {
    '(max-width: 1000px)': {
      display: 'none',
    },
  },
});

export const tocTitle = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVar('textSecondaryColor'),
  marginBottom: '8px',
});

export const tocItem = style({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  padding: '4px 6px',
  borderRadius: '4px',
  cursor: 'pointer',
  lineHeight: 1.4,
  ':hover': {
    backgroundColor: cssVar('hoverColor'),
    color: cssVar('textPrimaryColor'),
  },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

export const tocItemLevel = styleVariants({
  1: { paddingLeft: '6px' },
  2: { paddingLeft: '14px' },
  3: { paddingLeft: '22px' },
  4: { paddingLeft: '30px' },
  5: { paddingLeft: '38px' },
  6: { paddingLeft: '46px' },
});

export const main = style({
  flex: 1,
  overflowY: 'auto',
  padding: '32px 40px 96px',
  minWidth: 0,
  '@media': {
    '(max-width: 700px)': {
      padding: '20px 16px 72px',
    },
  },
});

export const article = style({
  maxWidth: '760px',
  margin: '0 auto',
  fontSize: cssVar('fontBase'),
  lineHeight: 1.7,
});

export const paragraph = style({
  margin: '0 0 16px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const heading = styleVariants({
  1: {
    fontSize: cssVar('fontH2'),
    fontWeight: 700,
    margin: '32px 0 16px',
    lineHeight: 1.3,
    scrollMarginTop: '16px',
  },
  2: {
    fontSize: cssVar('fontH4'),
    fontWeight: 700,
    margin: '28px 0 12px',
    lineHeight: 1.3,
    scrollMarginTop: '16px',
  },
  3: {
    fontSize: cssVar('fontH5'),
    fontWeight: 600,
    margin: '24px 0 10px',
    lineHeight: 1.4,
    scrollMarginTop: '16px',
  },
  4: {
    fontSize: cssVar('fontH6'),
    fontWeight: 600,
    margin: '20px 0 8px',
    scrollMarginTop: '16px',
  },
  5: {
    fontSize: cssVar('fontBase'),
    fontWeight: 600,
    margin: '18px 0 8px',
    scrollMarginTop: '16px',
  },
  6: {
    fontSize: cssVar('fontSm'),
    fontWeight: 600,
    color: cssVar('textSecondaryColor'),
    margin: '16px 0 8px',
    scrollMarginTop: '16px',
  },
});

/** Visually distinct but never the only signal - screen readers get the level. */
export const codeBlock = style({
  position: 'relative',
  margin: '0 0 16px',
  padding: '14px 16px',
  borderRadius: '8px',
  backgroundColor: cssVar('backgroundCodeBlock'),
  border: `1px solid ${cssVar('borderColor')}`,
  overflowX: 'auto',
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontSm'),
  lineHeight: 1.55,
  whiteSpace: 'pre',
});

export const codeLanguage = style({
  position: 'absolute',
  top: '6px',
  right: '10px',
  fontSize: cssVar('fontXs'),
  color: cssVar('textDisableColor'),
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const inlineCode = style({
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: '0.9em',
  padding: '2px 5px',
  borderRadius: '4px',
  backgroundColor: cssVar('backgroundCodeBlock'),
});

export const list = style({
  margin: '0 0 16px',
  paddingLeft: '24px',
});

export const listItem = style({
  margin: '0 0 6px',
});

export const blockquote = style({
  margin: '0 0 16px',
  paddingLeft: '14px',
  borderLeft: `3px solid ${cssVar('borderColor')}`,
  color: cssVar('textSecondaryColor'),
});

export const table = style({
  width: '100%',
  borderCollapse: 'collapse',
  margin: '0 0 16px',
  fontSize: cssVar('fontSm'),
});

export const tableCell = style({
  border: `1px solid ${cssVar('borderColor')}`,
  padding: '8px 10px',
  textAlign: 'left',
  verticalAlign: 'top',
});

export const tableHeaderCell = style([
  tableCell,
  {
    fontWeight: 600,
    backgroundColor: cssVar('backgroundSecondaryColor'),
  },
]);

export const rule = style({
  border: 'none',
  borderTop: `1px solid ${cssVar('borderColor')}`,
  margin: '24px 0',
});

export const taskList = style({
  margin: '0 0 16px',
  paddingLeft: '4px',
  listStyle: 'none',
});

export const taskItem = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  margin: '0 0 6px',
});

export const taskMarker = style({
  flexShrink: 0,
  fontFamily: cssVar('fontCodeFamily'),
  color: cssVar('textSecondaryColor'),
});

/** Frontmatter: shown, not interpreted. */
export const frontmatter = style({
  margin: '0 0 24px',
  padding: '12px 14px',
  borderRadius: '8px',
  border: `1px dashed ${cssVar('borderColor')}`,
  backgroundColor: cssVar('backgroundSecondaryColor'),
  color: cssVar('textSecondaryColor'),
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
});

export const frontmatterLabel = style({
  display: 'block',
  fontWeight: 700,
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
});

/** A construct the app deliberately will not render. */
export const unsupported = style({
  margin: '0 0 16px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${cssVar('warningColor')}`,
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-start',
});

export const unsupportedBadge = style({
  fontWeight: 700,
  color: cssVar('warningColor'),
  flexShrink: 0,
});

export const statusBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 16px',
  borderTop: `1px solid ${cssVar('borderColor')}`,
  fontSize: cssVar('fontXs'),
  flexShrink: 0,
  flexWrap: 'wrap',
});

/** Status colour is never the only signal: each state also has its own words. */
export const statusChip = styleVariants({
  'saved-to-repo': {
    color: cssVar('textSecondaryColor'),
  },
  'unsaved-draft': {
    color: cssVar('warningColor'),
    fontWeight: 600,
  },
  'updated-elsewhere': {
    color: cssVar('warningColor'),
    fontWeight: 600,
  },
  'conflict-review-needed': {
    color: cssVar('errorColor'),
    fontWeight: 700,
  },
  'file-moved-or-missing': {
    color: cssVar('errorColor'),
    fontWeight: 700,
  },
  'read-only': {
    color: cssVar('textSecondaryColor'),
    fontWeight: 600,
  },
});

/** Conflict compare: both versions side by side, neither hidden. */
export const conflictPanel = style({
  margin: '0 0 20px',
  border: `1px solid ${cssVar('errorColor')}`,
  borderRadius: '8px',
  overflow: 'hidden',
});

export const conflictHeader = style({
  padding: '10px 14px',
  backgroundColor: cssVar('backgroundSecondaryColor'),
  fontWeight: 700,
  fontSize: cssVar('fontSm'),
});

export const conflictBody = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  '@media': {
    '(max-width: 800px)': { gridTemplateColumns: '1fr' },
  },
});

export const conflictColumn = style({
  padding: '12px 14px',
  minWidth: 0,
});

export const conflictColumnLabel = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVar('textSecondaryColor'),
  marginBottom: '6px',
});

export const conflictPre = style({
  margin: 0,
  padding: '10px',
  borderRadius: '6px',
  backgroundColor: cssVar('backgroundCodeBlock'),
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '240px',
  overflowY: 'auto',
});

export const conflictActions = style({
  display: 'flex',
  gap: '8px',
  padding: '12px 14px',
  borderTop: `1px solid ${cssVar('borderColor')}`,
  flexWrap: 'wrap',
});

export const editor = style({
  flex: 1,
  width: '100%',
  minHeight: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  padding: '24px 32px 96px',
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontSm'),
  lineHeight: 1.65,
  color: cssVar('textPrimaryColor'),
  backgroundColor: cssVar('backgroundPrimaryColor'),
  tabSize: 2,
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

export const fileList = style({
  width: '100%',
  maxWidth: '520px',
  maxHeight: '320px',
  overflowY: 'auto',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '8px',
  textAlign: 'left',
});

export const fileListButton = style({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  border: 'none',
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontXs'),
  cursor: 'pointer',
  ':hover': { backgroundColor: cssVar('hoverColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '-2px',
  },
});

export const notice = style({
  padding: '10px 14px',
  borderRadius: '8px',
  backgroundColor: cssVar('backgroundSecondaryColor'),
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  margin: '0 0 16px',
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-start',
});

/**
 * Text for screen readers only.
 *
 * A task's checked state is communicated as words, not only as the `[x]` glyph,
 * so it is not lost on a reader that does not announce punctuation.
 */
export const visuallyHidden = style({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
