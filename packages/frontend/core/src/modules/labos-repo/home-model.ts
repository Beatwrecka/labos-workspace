/**
 * LabOS Workspace — home screen model.
 *
 * The home screen answers four questions in order of usefulness:
 *   1. What should I continue?      — the repo document you last had open
 *   2. Which projects matter now?   — the shortlist, then recent work
 *   3. What actually changed?       — recent MEANINGFUL work, not polling time
 *   4. What needs me?               — real blockers, in plain language
 *
 * The rules that shape it:
 *
 *  - **"Needs you" is never padded.** It lists only things the sources actually
 *    report as needing attention: a blocked task, a repository document in
 *    conflict or missing, an unreadable folder. An empty list says so.
 *  - **Recent work is ordered by when the work happened**, using timestamps the
 *    sources provide, not by when LabOS last fetched them.
 *  - **Nothing is invented.** If no repository folder is registered, the
 *    continue-writing slot says that rather than showing a blank card.
 *
 * Pure logic, no React, so it is testable directly.
 */

export interface LabosHomeRepoDoc {
  rootId: string;
  rootLabel: string;
  relativePath: string;
  /** When the reader last opened it, so "continue" means what it says. */
  lastOpenedAt: string;
  /** Set when the document is in a state that needs attention. */
  status: string | null;
}

export interface LabosHomeProject {
  slug: string;
  name: string;
  summary: string | null;
  /** Reported project status, or null when none is recorded. */
  status: string | null;
  /** When meaningful work last happened, from the source. */
  lastMeaningfulWorkAt: string | null;
  /** True when the project is on the reader's shortlist. */
  pinned: boolean;
}

export interface LabosHomeBlocker {
  /** Where it came from, so the reader can trust the claim. */
  source: 'memcp-task' | 'repo-document' | 'repo-root';
  title: string;
  detail: string;
  /** Enough to act on it. */
  href: string;
}

export interface LabosHomeChange {
  id: string;
  title: string;
  summary: string;
  occurredAt: string;
  /** Reported vs verified, carried through rather than flattened. */
  provenance: string;
  projectSlug: string | null;
}

export interface LabosHomeState {
  continueWriting: {
    document: LabosHomeRepoDoc | null;
    /** Why there is nothing to continue, when there is nothing. */
    reason: string | null;
  };
  priorityProjects: LabosHomeProject[];
  recentWork: LabosHomeChange[];
  needsYou: LabosHomeBlocker[];
  /** Problems reading the sources, stated rather than hidden. */
  sources: {
    memcp: 'connected' | 'disconnected' | 'cached';
    repoFolders: number;
  };
}

const MAX_RECENT = 6;
const MAX_BLOCKERS = 5;

/** Order by a timestamp, newest first, with a stable tiebreak. */
function newestFirst<T>(
  items: T[],
  key: (item: T) => string | null,
  id: (item: T) => string
): T[] {
  return [...items].sort((left, right) => {
    const leftKey = key(left) ?? '';
    const rightKey = key(right) ?? '';
    const byTime = rightKey.localeCompare(leftKey);
    return byTime !== 0 ? byTime : id(left).localeCompare(id(right));
  });
}

/**
 * The document to continue.
 *
 * Only a document that is still an ordinary file is offered: continuing a
 * document that has since been deleted or moved would be a broken promise, so
 * those are surfaced under "Needs you" instead.
 */
export function pickContinueWriting(
  documents: LabosHomeRepoDoc[],
  rootsRegistered: number
): LabosHomeState['continueWriting'] {
  if (rootsRegistered === 0) {
    return {
      document: null,
      reason: 'No repository folder has been added yet.',
    };
  }
  if (documents.length === 0) {
    return {
      document: null,
      reason: 'No repository document has been opened yet.',
    };
  }
  const usable = documents.filter(
    document => document.status !== 'file-moved-or-missing'
  );
  if (usable.length === 0) {
    return {
      document: null,
      reason:
        'The documents opened most recently have moved or gone missing. They are listed under Needs you.',
    };
  }
  const [mostRecent] = newestFirst(
    usable,
    document => document.lastOpenedAt,
    document => `${document.rootId}:${document.relativePath}`
  );
  return { document: mostRecent, reason: null };
}

/**
 * Priority projects: the shortlist first, then the rest by meaningful work.
 *
 * The shortlist order is the reader's stated priority and is not re-sorted.
 */
export function pickPriorityProjects(
  projects: LabosHomeProject[],
  shortlist: string[],
  limit = 6
): LabosHomeProject[] {
  const bySlug = new Map(projects.map(project => [project.slug, project]));
  const pinned: LabosHomeProject[] = [];
  const seen = new Set<string>();

  for (const slug of shortlist) {
    const project = bySlug.get(slug);
    if (!project || seen.has(slug)) continue;
    pinned.push(project);
    seen.add(slug);
  }

  const rest = newestFirst(
    projects.filter(project => !seen.has(project.slug)),
    project => project.lastMeaningfulWorkAt,
    project => project.slug
  );

  return [...pinned, ...rest].slice(0, limit);
}

/**
 * Recent meaningful work.
 *
 * Ordered by when the change occurred, and each entry keeps its provenance so
 * "reported" never reads as "verified".
 */
export function pickRecentWork(
  changes: LabosHomeChange[],
  limit = MAX_RECENT
): LabosHomeChange[] {
  return newestFirst(
    changes.filter(change => Boolean(change.occurredAt)),
    change => change.occurredAt,
    change => change.id
  ).slice(0, limit);
}

/**
 * What needs you.
 *
 * Built only from things the sources report as needing attention. There is no
 * heuristic that promotes "in progress" or "overdue-looking" work into this
 * list, because a list that cries wolf stops being read.
 */
export function pickNeedsYou(input: {
  blocks: { task: string; detail: string; projectSlug: string }[];
  documents: LabosHomeRepoDoc[];
  unavailableRoots: { id: string; label: string }[];
}): LabosHomeBlocker[] {
  const blockers: LabosHomeBlocker[] = [];

  for (const block of input.blocks) {
    blockers.push({
      source: 'memcp-task',
      title: block.task,
      detail: block.detail,
      href: `/labos/projects`,
    });
  }

  for (const document of input.documents) {
    if (document.status === 'conflict-review-needed') {
      blockers.push({
        source: 'repo-document',
        title: `${document.relativePath} has conflicting versions`,
        detail:
          'It changed on disk while you were editing, so both versions were kept. Choose which to keep.',
        href: `/labos/repo`,
      });
    } else if (document.status === 'file-moved-or-missing') {
      blockers.push({
        source: 'repo-document',
        title: `${document.relativePath} has moved or gone missing`,
        detail:
          'Your draft was kept. Rebind it, restore it as a new file, or discard it.',
        href: `/labos/repo`,
      });
    }
  }

  for (const root of input.unavailableRoots) {
    blockers.push({
      source: 'repo-root',
      title: `The folder "${root.label}" could not be read`,
      detail:
        'It may have moved, been unmounted, or its permission may have been revoked. Your drafts are retained.',
      href: `/labos/repo`,
    });
  }

  // Real blockers are not ordered by recency, so they keep source order: tasks,
  // then documents, then folders. That puts the most actionable first.
  return blockers.slice(0, MAX_BLOCKERS);
}

/** Assemble the full home state. */
export function buildHomeState(input: {
  repoDocuments: LabosHomeRepoDoc[];
  rootsRegistered: number;
  unavailableRoots: { id: string; label: string }[];
  projects: LabosHomeProject[];
  shortlist: string[];
  changes: LabosHomeChange[];
  blocks: { task: string; detail: string; projectSlug: string }[];
  memcp: 'connected' | 'disconnected' | 'cached';
}): LabosHomeState {
  return {
    continueWriting: pickContinueWriting(
      input.repoDocuments,
      input.rootsRegistered
    ),
    priorityProjects: pickPriorityProjects(input.projects, input.shortlist),
    recentWork: pickRecentWork(input.changes),
    needsYou: pickNeedsYou({
      blocks: input.blocks,
      documents: input.repoDocuments,
      unavailableRoots: input.unavailableRoots,
    }),
    sources: {
      memcp: input.memcp,
      repoFolders: input.rootsRegistered,
    },
  };
}
