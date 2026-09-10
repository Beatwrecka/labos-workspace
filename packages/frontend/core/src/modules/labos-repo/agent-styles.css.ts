/**
 * LabOS Workspace — agent panel styles.
 *
 * The panel is deliberately plain: the reader is about to send document text to
 * a model, so the emphasis is on clarity about what will be sent and what came
 * back, not on visual flourish.
 */

import { cssVar } from '@toeverything/theme';
import { style, styleVariants } from '@vanilla-extract/css';

export const panel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  maxWidth: '760px',
});

export const unavailable = style({
  padding: '12px 14px',
  borderRadius: '8px',
  border: `1px solid ${cssVar('borderColor')}`,
  backgroundColor: cssVar('backgroundSecondaryColor'),
  color: cssVar('textSecondaryColor'),
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
});

export const actionRow = style({
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
});

export const actionButton = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  alignItems: 'flex-start',
  textAlign: 'left',
  padding: '10px 12px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '8px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  maxWidth: '240px',
  ':hover': { borderColor: cssVar('primaryColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
  ':disabled': { opacity: 0.5, cursor: 'default' },
});

export const actionLabel = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
});

/** The description is always visible, so the reader knows what will be sent. */
export const actionDescription = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
  lineHeight: 1.45,
});

export const promptPreview = style({
  margin: 0,
  padding: '12px 14px',
  borderRadius: '8px',
  backgroundColor: cssVar('backgroundCodeBlock'),
  border: `1px solid ${cssVar('borderColor')}`,
  fontFamily: cssVar('fontCodeFamily'),
  fontSize: cssVar('fontXs'),
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '220px',
  overflowY: 'auto',
});

export const previewToggle = style({
  alignSelf: 'flex-start',
  border: 'none',
  background: 'transparent',
  color: cssVar('primaryColor'),
  fontSize: cssVar('fontXs'),
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'underline',
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

export const jobCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '12px 14px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: '8px',
});

/** Job state is always spelled out, never only coloured. */
export const jobState = styleVariants({
  running: { color: cssVar('textSecondaryColor'), fontWeight: 600 },
  completed: { color: cssVar('successColor'), fontWeight: 600 },
  failed: { color: cssVar('errorColor'), fontWeight: 600 },
  cancelled: { color: cssVar('textSecondaryColor'), fontWeight: 600 },
  'timed-out': { color: cssVar('warningColor'), fontWeight: 600 },
  queued: { color: cssVar('textSecondaryColor'), fontWeight: 600 },
});

export const jobHeader = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '10px',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
});

export const jobLabel = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 700,
});

export const jobMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVar('textSecondaryColor'),
});

/** A proposal is visually distinct from an answer, because it needs review. */
export const proposalNotice = style({
  padding: '8px 12px',
  borderRadius: '6px',
  border: `1px solid ${cssVar('warningColor')}`,
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
});

export const resultBody = style({
  margin: 0,
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const cancelButton = style({
  alignSelf: 'flex-start',
  border: `1px solid ${cssVar('borderColor')}`,
  background: 'transparent',
  color: cssVar('textPrimaryColor'),
  borderRadius: '6px',
  padding: '5px 10px',
  fontSize: cssVar('fontXs'),
  cursor: 'pointer',
  ':hover': { backgroundColor: cssVar('hoverColor') },
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '2px',
  },
});

export const questionInput = style({
  width: '100%',
  padding: '8px 10px',
  borderRadius: '6px',
  border: `1px solid ${cssVar('borderColor')}`,
  backgroundColor: cssVar('backgroundPrimaryColor'),
  color: cssVar('textPrimaryColor'),
  fontSize: cssVar('fontSm'),
  fontFamily: 'inherit',
  resize: 'vertical',
  minHeight: '38px',
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: '1px',
  },
});
