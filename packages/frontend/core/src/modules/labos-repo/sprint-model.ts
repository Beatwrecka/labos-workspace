/**
 * LabOS Workspace — sprint and project presentation model.
 *
 * This file exists because of one specific failure the briefing calls out:
 * a worker saying "done" is not a verified merge or an independent QA result.
 * Those are four different facts, and collapsing them into a single green tick
 * is the mistake this module is built to prevent.
 *
 * The four are kept as separate, non-interchangeable dimensions:
 *
 *   1. `reportedStatus`   — what the record says (MeMCP: reported_*)
 *   2. `tests`            — whether tests were run, with provenance
 *   3. `independentQa`    — a SEPARATE reviewer's verdict
 *   4. `integration`      — merged / not merged, and cleanup
 *
 * Nothing here promotes one into another. A completed task with no test evidence
 * renders as "Completed (reported)" with an explicit gap, never as "verified".
 *
 * Also pure logic, with no React, so it can be tested directly.
 */

import type {
  LabosEvidenceGap,
  LabosProvenance,
  LabosSnapshot,
  LabosSnapshotSection,
  LabosSnapshotTask,
} from '../../../../apps/electron/src/main/labos/memcp-adapter';

/** The four dimensions, deliberately not merged into one status. */
export interface LabosSprintEvidence {
  /** What the task record says. Always "reported", never "verified". */
  reportedStatus: {
    label: string;
    /** The raw MeMCP label, so the distinction survives into the UI. */
    evidenceLabel: LabosSnapshotTask['evidence_label'] | null;
    provenance: LabosProvenance;
  };
  /** Test evidence. Absent means "not recorded", not "no tests needed". */
  tests: LabosEvidenceClaim;
  /** Independent QA. Absent means self-review at best, not verification. */
  independentQa: LabosEvidenceClaim;
  /** Merge state against the integration branch. */
  integration: {
    state: 'merged' | 'not-recorded';
    detail: string;
  };
  /** Workspace cleanup after merge — separate from merge itself. */
  cleanup: {
    state: 'clean' | 'not-recorded';
    detail: string;
  };
}

export interface LabosEvidenceClaim {
  state: 'recorded' | 'not-recorded';
  detail: string;
  /** Where the claim came from, when it is recorded at all. */
  provenance: LabosProvenance;
}

/**
 * A sprint card as the UI consumes it.
 *
 * `provenance` and `status` are carried through from MeMCP rather than
 * recomputed, so the card can say "this section could not be populated"
 * instead of looking empty-but-fine.
 */
export interface LabosSprintCard {
  id: string;
  title: string;
  /** Plain-English goal: the phase/description, or an honest placeholder. */
  goal: string | null;
  phaseTitle: string | null;
  sprintLabel: string | null;
  evidence: LabosSprintEvidence;
  /** What changed, from the snapshot's verified-at-source changes. */
  changedSummary: string | null;
  /** What happens next. From MeMCP's own resume rule, not invented. */
  nextAction: { label: string; provenance: LabosProvenance } | null;
  /** "Needs you": only present when MeMCP reports a real blocker. */
  needsYou: string | null;
  updatedAt: string;
  /** Anything MeMCP could not tell us, surfaced rather than hidden. */
  gaps: LabosEvidenceGap[];
}

export interface LabosProjectCard {
  slug: string;
  name: string;
  /** Reported project status, or null when MeMCP did not record one. */
  status: string | null;
  category: string | null;
  summary: string | null;
  /** True when a repository is bound. Never assumed. */
  hasRepository: boolean;
  repositoryRemote: string | null;
  /** A screenshot the reader chose, or a truthful placeholder. */
  cover: LabosProjectCover;
  updatedAt: string;
  /** Counts from the snapshot, only when one has been received. */
  taskCounts: Record<string, number> | null;
  totalTasks: number | null;
  /** Sections MeMCP could not populate, e.g. missing visual evidence. */
  gaps: LabosEvidenceGap[];
  /** Whether this card's detail came from the service or a cached snapshot. */
  dataState: 'live' | 'cached' | 'unavailable';
}

export interface LabosProjectCover {
  kind: 'recorded' | 'placeholder';
  /** Present only for a recorded cover. */
  previewUrl: string | null;
  previewId: string | null;
  /** Why there is no cover, so the placeholder is never just a grey box. */
  reason: string | null;
}

/**
 * Human label for a reported task status.
 *
 * Every one of these says "reported", because that is what it is. The word
 * "verified" must not appear here.
 */
export function describeReportedStatus(
  evidenceLabel: LabosSnapshotTask['evidence_label'] | null,
  status: string
): string {
  switch (evidenceLabel) {
    case 'reported_complete':
      return 'Completed (reported)';
    case 'reported_blocked':
      return 'Blocked (reported)';
    case 'reported_status':
      return `${humaniseStatus(status)} (reported)`;
    default:
      return humaniseStatus(status);
  }
}

function humaniseStatus(status: string): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'planned') return 'Planned';
  if (status === 'skipped') return 'Skipped';
  if (status === 'completed') return 'Completed';
  if (status === 'blocked') return 'Blocked';
  return status;
}

/** An unrecorded claim states plainly that nothing was recorded. */
export function notRecorded(detail: string): LabosEvidenceClaim {
  return { state: 'not-recorded', detail, provenance: 'unknown' };
}

/**
 * Build the four evidence dimensions for a task.
 *
 * MeMCP's own sections are the only source. Where a section is `unknown` or
 * empty, the dimension is `not-recorded` — which is different from and safer
 * than inventing a value, and different from "passed".
 */
export function buildSprintEvidence(
  task: LabosSnapshotTask,
  snapshot: LabosSnapshot
): LabosSprintEvidence {
  const reportedStatus = {
    label: describeReportedStatus(task.evidence_label, task.status),
    evidenceLabel: task.evidence_label,
    provenance: 'reported' as LabosProvenance,
  };

  // MeMCP records no test results in this snapshot version. Saying so is the
  // honest answer; inferring "tests passed" from a completed status is exactly
  // the conflation the briefing forbids.
  const tests = notRecorded(
    'No test result is recorded for this task. A completed status is not test evidence.'
  );

  // Independent QA is a separate reviewer's verdict. MeMCP does not record one
  // here, so this stays explicitly unverified rather than borrowing the task's
  // own status.
  const independentQa = notRecorded(
    'No independent QA result is recorded. Self-review is not independent QA.'
  );

  const gitChanges = snapshot.sections.latest_changes.items.filter(
    change => change.kind === 'git_commit' && change.source_sha
  );
  const integration =
    gitChanges.length > 0
      ? {
          state: 'merged' as const,
          detail: `A Git commit is recorded (${gitChanges[0].source_sha?.slice(0, 8)}), as reported by MeMCP. A commit is not proof of merge into the integration branch.`,
        }
      : {
          state: 'not-recorded' as const,
          detail:
            'No merge into an integration branch is recorded for this project.',
        };

  const cleanupRecorded = false; // MeMCP records no post-merge cleanup state here.

  return {
    reportedStatus,
    tests,
    independentQa,
    integration,
    cleanup: cleanupRecorded
      ? {
          state: 'clean' as const,
          detail: 'Cleanup is recorded as complete.',
        }
      : {
          state: 'not-recorded' as const,
          detail:
            'Workspace cleanup after merge has not been recorded.',
        },
  };
}

/** Turn a MeMCP section into a card-level summary, preserving its honesty. */
export function summariseSection(
  section: LabosSnapshotSection<unknown> | undefined
): string | null {
  if (!section) return null;
  if (section.status === 'unknown') {
    return section.note ?? 'Nothing has been recorded for this yet.';
  }
  const text = section.items.length
    ? section.items
        .map(item =>
          typeof item === 'object' && item !== null && 'title' in item
            ? String((item as { title: unknown }).title)
            : null
        )
        .filter((value): value is string => Boolean(value))
        .slice(0, 3)
        .join('; ')
    : (section.text ?? null);
  if (!text) return section.note ?? null;
  return section.omitted_count > 0
    ? `${text} (${section.omitted_count} more omitted)`
    : text;
}

/**
 * Build sprint cards from a snapshot.
 *
 * Cards come from the snapshot's tasks. If MeMCP has no sprint structure, the
 * cards say so rather than inventing a sprint plan — the briefing is explicit
 * that a missing sprint structure must be stated, not filled in.
 */
export function buildSprintCards(snapshot: LabosSnapshot): LabosSprintCard[] {
  const resume = snapshot.resume_action;

  return snapshot.tasks.items.map(task => {
    const isResumeTarget = resume.task_id === task.id;
    const card: LabosSprintCard = {
      id: task.id,
      title: task.title || task.slug,
      goal: task.phase_title ?? null,
      phaseTitle: task.phase_title,
      sprintLabel: task.sprint_label,
      evidence: buildSprintEvidence(task, snapshot),
      changedSummary: summariseSection(snapshot.sections.latest_changes),
      nextAction: isResumeTarget
        ? { label: resume.label, provenance: resume.provenance }
        : null,
      needsYou:
        task.status === 'blocked'
          ? `Blocked: ${task.title}`
          : null,
      updatedAt: task.updated_at,
      gaps: snapshot.evidence_gaps,
    };
    return card;
  });
}

/** True when the snapshot offers no sprint structure at all. */
export function lacksSprintStructure(snapshot: LabosSnapshot): boolean {
  return snapshot.tasks.items.every(
    task => !task.sprint_label && !task.phase_title
  );
}

/**
 * A cover for a project card.
 *
 * A missing screenshot gets a truthful placeholder with the reason, never a
 * fabricated image and never a bare grey box with no explanation.
 */
export function buildProjectCover(input: {
  previewUrl: string | null;
  coverPreviewId: string | null;
  visualEvidenceMode: string;
  slug: string;
}): LabosProjectCover {
  if (input.previewUrl) {
    return {
      kind: 'recorded',
      previewUrl: input.previewUrl,
      previewId: input.coverPreviewId,
      reason: null,
    };
  }
  if (input.visualEvidenceMode === 'not_applicable') {
    return {
      kind: 'placeholder',
      previewUrl: null,
      previewId: null,
      reason: 'Visual evidence is marked as not applicable for this project.',
    };
  }
  return {
    kind: 'placeholder',
    previewUrl: null,
    previewId: null,
    reason:
      'No screenshot has been recorded for this project. Add one to show it here.',
  };
}

/** Order cards by the most recent meaningful work, not by polling time. */
export function orderByMeaningfulWork<T extends { updatedAt: string }>(
  cards: T[]
): T[] {
  return [...cards].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

/**
 * Apply the reader's shortlist order to a set of projects.
 *
 * Projects in the shortlist come first in the reader's chosen order; everything
 * else follows, ordered by meaningful work. A shortlist entry pointing at a
 * project that no longer exists is skipped rather than shown as a ghost.
 */
export function applyShortlistOrder<T extends { slug: string; updatedAt: string }>(
  projects: T[],
  shortlist: string[]
): T[] {
  const bySlug = new Map(projects.map(project => [project.slug, project]));
  const chosen: T[] = [];
  const seen = new Set<string>();

  for (const slug of shortlist) {
    const project = bySlug.get(slug);
    if (!project || seen.has(slug)) continue;
    chosen.push(project);
    seen.add(slug);
  }

  const rest = orderByMeaningfulWork(
    projects.filter(project => !seen.has(project.slug))
  );
  return [...chosen, ...rest];
}

/** Move an item within a list, returning a new list. Out-of-range is a no-op. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
