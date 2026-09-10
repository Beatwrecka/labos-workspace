/**
 * LabOS Workspace — sprint cards, project gallery and shortlist.
 *
 * Renders the model from `sprint-model.ts`. The visual job is to make the four
 * evidence dimensions read as FOUR things, so that a reported completion cannot
 * be mistaken for a verified result:
 *
 *   Reported status   — what the record says
 *   Tests             — run, with provenance, or explicitly not recorded
 *   Independent QA    — a separate reviewer's verdict, or explicitly not recorded
 *   Merged / cleanup  — integration state, separate from merge itself
 *
 * Each row states its own value in words. Colour is never the only signal, and
 * "not recorded" is rendered as a dashed outline rather than a quiet green, so
 * absence reads as absence rather than as a pass.
 */

import { type KeyboardEvent, useCallback, useState } from 'react';

import type { LabosEvidenceGap } from '../../../../apps/electron/src/main/labos/memcp-adapter';
import type {
  LabosEvidenceClaim,
  LabosProjectCard,
  LabosSprintCard,
} from './sprint-model';
import {
  card,
  cardBody,
  cardGoal,
  cardHeader,
  cardHeading,
  cardList,
  cardMeta,
  cardTitle,
  cover as coverStyle,
  coverPlaceholder,
  emptyState,
  emptyTitle,
  evidenceBadge,
  evidenceDetail,
  evidenceGrid,
  evidenceLabelCell,
  evidenceValueCell,
  expandIndicator,
  gallery,
  galleryLayout,
  gapItem,
  gapList,
  moveButton,
  needsYou,
  notice,
  projectBody,
  projectCard,
  projectMeta,
  projectName,
  projectSummary,
  shortlist as shortlistStyle,
  shortlistItem,
  shortlistLabel,
  shortlistTitle,
  statusChip,
} from './sprint-styles.css';

/** Render an evidence claim, making absence read as absence. */
function ClaimRow({
  label,
  state,
  badgeText,
  detail,
}: {
  label: string;
  state: 'recorded' | 'not-recorded';
  badgeText: string;
  detail: string;
}) {
  return (
    <>
      <div className={evidenceLabelCell}>{label}</div>
      <div className={evidenceValueCell}>
        <span className={evidenceBadge[state === 'recorded' ? 'recorded' : 'unrecorded']}>
          {badgeText}
        </span>
        <span className={evidenceDetail}>{detail}</span>
      </div>
    </>
  );
}

function claimBadgeText(claim: LabosEvidenceClaim, recordedText: string): string {
  return claim.state === 'recorded' ? recordedText : 'Not recorded';
}

export function LabosSprintCardView({
  card: sprintCard,
  defaultExpanded = false,
}: {
  card: LabosSprintCard;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const evidence = sprintCard.evidence;

  const toggle = useCallback(() => setExpanded(current => !current), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    },
    [toggle]
  );

  return (
    <article className={card}>
      <button
        type="button"
        className={cardHeader}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className={cardHeading}>
          <h3 className={cardTitle}>{sprintCard.title}</h3>
          <span className={cardMeta}>
            {sprintCard.phaseTitle ? <span>{sprintCard.phaseTitle}</span> : null}
            {sprintCard.sprintLabel ? <span>{sprintCard.sprintLabel}</span> : null}
            {/* The reported status is shown collapsed too, always labelled. */}
            <span className={evidenceBadge.reported}>
              {evidence.reportedStatus.label}
            </span>
          </span>
          {sprintCard.goal ? <p className={cardGoal}>{sprintCard.goal}</p> : null}
        </span>
        <span className={expandIndicator} aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>

      {expanded ? (
        <div className={cardBody}>
          {sprintCard.needsYou ? (
            <p className={needsYou}>Needs you — {sprintCard.needsYou}</p>
          ) : null}

          {/* Four separate dimensions. This grid is the feature. */}
          <div className={evidenceGrid}>
            <div className={evidenceLabelCell}>Reported status</div>
            <div className={evidenceValueCell}>
              <span className={evidenceBadge.reported}>
                {evidence.reportedStatus.label}
              </span>
              <span className={evidenceDetail}>
                Reported by MeMCP from the task record. This is not a verified
                outcome.
              </span>
            </div>

            <ClaimRow
              label="Tests"
              state={evidence.tests.state}
              badgeText={claimBadgeText(evidence.tests, 'Recorded')}
              detail={evidence.tests.detail}
            />

            <ClaimRow
              label="Independent QA"
              state={evidence.independentQa.state}
              badgeText={claimBadgeText(evidence.independentQa, 'Reviewed')}
              detail={evidence.independentQa.detail}
            />

            <ClaimRow
              label="Integration"
              state={
                evidence.integration.state === 'merged' ? 'recorded' : 'not-recorded'
              }
              badgeText={
                evidence.integration.state === 'merged'
                  ? 'Commit recorded'
                  : 'Not recorded'
              }
              detail={evidence.integration.detail}
            />

            <ClaimRow
              label="Cleanup"
              state={
                evidence.cleanup.state === 'clean' ? 'recorded' : 'not-recorded'
              }
              badgeText={
                evidence.cleanup.state === 'clean' ? 'Clean' : 'Not recorded'
              }
              detail={evidence.cleanup.detail}
            />
          </div>

          {sprintCard.changedSummary ? (
            <>
              <div className={evidenceLabelCell}>What changed</div>
              <p className={evidenceDetail}>{sprintCard.changedSummary}</p>
            </>
          ) : null}

          {sprintCard.nextAction ? (
            <>
              <div className={evidenceLabelCell}>Next</div>
              <p className={evidenceDetail}>
                {sprintCard.nextAction.label} ({sprintCard.nextAction.provenance})
              </p>
            </>
          ) : null}

          <EvidenceGaps gaps={sprintCard.gaps} />
        </div>
      ) : null}
    </article>
  );
}

/** Gaps are listed, never summarised away. */
function EvidenceGaps({ gaps }: { gaps: LabosEvidenceGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className={gapList}>
      {gaps.slice(0, 4).map(gap => (
        <li key={gap.code} className={gapItem}>
          <span aria-hidden="true">•</span>
          <span>{gap.message}</span>
        </li>
      ))}
      {gaps.length > 4 ? (
        <li className={gapItem}>
          <span aria-hidden="true">•</span>
          <span>{gaps.length - 4} more not shown</span>
        </li>
      ) : null}
    </ul>
  );
}

export function LabosSprintList({
  cards,
  structured,
}: {
  cards: LabosSprintCard[];
  /** False when MeMCP recorded no sprint or phase structure at all. */
  structured: boolean;
}) {
  if (cards.length === 0) {
    return (
      <div className={emptyState}>
        <span className={emptyTitle}>No tasks recorded for this project</span>
        <span>
          MeMCP has no task records for this project yet, so there is nothing to
          show. LabOS does not invent a sprint plan.
        </span>
      </div>
    );
  }

  return (
    <>
      {!structured ? (
        <p className={notice} role="status">
          <span aria-hidden="true">▪</span>
          <span>
            MeMCP has no sprint or phase structure recorded for this project, so
            these are its task groups as recorded. No sprint plan has been
            invented.
          </span>
        </p>
      ) : null}
      <div className={cardList}>
        {cards.map(sprintCard => (
          <LabosSprintCardView key={sprintCard.id} card={sprintCard} />
        ))}
      </div>
    </>
  );
}

// --- gallery ---------------------------------------------------------------------

export function LabosProjectGallery({
  projects,
  onOpen,
}: {
  projects: LabosProjectCard[];
  onOpen: (slug: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <div className={emptyState}>
        <span className={emptyTitle}>No projects to show</span>
        <span>
          MeMCP has no projects recorded, so the gallery is empty. This is not a
          loading state.
        </span>
      </div>
    );
  }

  return (
    <div className={gallery}>
      {projects.map(project => (
        <button
          key={project.slug}
          type="button"
          className={projectCard}
          onClick={() => onOpen(project.slug)}
        >
          {project.cover.kind === 'recorded' && project.cover.previewUrl ? (
            <img
              className={coverStyle}
              src={project.cover.previewUrl}
              alt={`Screenshot of ${project.name}`}
              loading="lazy"
            />
          ) : (
            <span className={coverPlaceholder}>
              {project.cover.reason ?? 'No screenshot recorded.'}
            </span>
          )}
          <span className={projectBody}>
            <h3 className={projectName}>{project.name}</h3>
            {project.summary ? (
              <p className={projectSummary}>{project.summary}</p>
            ) : (
              <p className={projectSummary}>
                No summary recorded for this project.
              </p>
            )}
            <span className={projectMeta}>
              {/* A null status says so; it is never defaulted to "active". */}
              <span className={statusChip}>
                {project.status ?? 'No status recorded'}
              </span>
              {project.hasRepository ? (
                project.repositoryRemote ? (
                  <span className={statusChip}>Repository bound</span>
                ) : (
                  <span className={statusChip}>Repository bound (no remote)</span>
                )
              ) : (
                <span className={statusChip}>No repository bound</span>
              )}
              {project.dataState === 'cached' ? (
                <span className={statusChip}>Cached</span>
              ) : null}
              {project.taskCounts ? (
                <span className={statusChip}>
                  {project.totalTasks ?? 0} tasks
                </span>
              ) : null}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// --- shortlist ---------------------------------------------------------------------

/**
 * A keyboard-accessible reorderable shortlist.
 *
 * Reordering uses real buttons rather than drag-and-drop alone, so it works with
 * a keyboard and a screen reader as well as a pointer. Each control is labelled
 * with the project it moves, because "Move up" repeated six times is useless to
 * a screen reader.
 */
export function LabosShortlist({
  items,
  onMove,
  onRemove,
}: {
  items: { slug: string; name: string }[];
  onMove: (slug: string, direction: 'up' | 'down') => void;
  onRemove: (slug: string) => void;
}) {
  return (
    <aside className={shortlistStyle} aria-label="Priority shortlist">
      <h2 className={shortlistTitle}>Priority shortlist</h2>
      {items.length === 0 ? (
        <p className={evidenceDetail}>
          No projects pinned yet. Pin one to keep it at the top of the gallery.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item, index) => (
            <li key={item.slug} className={shortlistItem}>
              <span className={shortlistLabel} title={item.name}>
                {item.name}
              </span>
              <button
                type="button"
                className={moveButton}
                disabled={index === 0}
                aria-label={`Move ${item.name} up`}
                onClick={() => onMove(item.slug, 'up')}
              >
                ↑
              </button>
              <button
                type="button"
                className={moveButton}
                disabled={index === items.length - 1}
                aria-label={`Move ${item.name} down`}
                onClick={() => onMove(item.slug, 'down')}
              >
                ↓
              </button>
              <button
                type="button"
                className={moveButton}
                aria-label={`Remove ${item.name} from the shortlist`}
                onClick={() => onRemove(item.slug)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function LabosGalleryLayout({
  children,
  shortlist,
}: {
  children: React.ReactNode;
  shortlist: React.ReactNode;
}) {
  return (
    <div className={galleryLayout}>
      {children}
      {shortlist}
    </div>
  );
}
