/**
 * LabOS Workspace — home screen view.
 *
 * Four sections in order of usefulness, each of which states its own emptiness
 * rather than showing a blank box:
 *
 *   Continue writing        — the document you last had open
 *   Priority projects       — your shortlist, then recent work
 *   Recent meaningful work  — ordered by when the work happened
 *   Needs you               — only real blockers; empty means empty
 *
 * Presentation only. The judgement lives in `home-model.ts`, tested separately.
 */

import type {
  LabosHomeBlocker,
  LabosHomeChange,
  LabosHomeProject,
  LabosHomeRepoDoc,
  LabosHomeState,
} from './home-model';
import { s } from './home-styles.css';
import {
  detailText,
  emptyState,
  evidenceDetail,
  notice,
  projectMeta,
  statusChip,
} from './sprint-styles.css';

/** A relative age, so "recent" comes with a number rather than a vibe. */
export function describeWhen(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'time not recorded';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className={s.section} data-labos-section={testId}>
      <h2 className={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

export function LabosHomeView({
  state,
  onOpenDocument,
  onOpenProjects,
  onOpenRepo,
}: {
  state: LabosHomeState;
  onOpenDocument: (rootId: string, relativePath: string) => void;
  onOpenProjects: () => void;
  onOpenRepo: () => void;
}) {
  return (
    <div className={s.page} data-labos-home>
      <header className={s.header}>
        <h1 className={s.title}>LabOS Workspace</h1>
        <div className={s.headerActions}>
          <button type="button" className={s.linkButton} onClick={onOpenRepo}>
            Repository documents
          </button>
          <button type="button" className={s.linkButton} onClick={onOpenProjects}>
            Projects
          </button>
        </div>
      </header>

      <div className={s.body}>
        {/* 1. Continue writing */}
        <Section title="Continue writing" testId="continue-writing">
          {state.continueWriting.document ? (
            <ContinueCard
              document={state.continueWriting.document}
              onOpen={onOpenDocument}
            />
          ) : (
            <p className={detailText}>
              {state.continueWriting.reason ??
                'No repository document has been opened yet.'}
            </p>
          )}
        </Section>

        {/* 2. Priority projects */}
        <Section title="Priority projects" testId="priority-projects">
          {state.priorityProjects.length === 0 ? (
            <p className={detailText}>
              {state.sources.memcp === 'connected'
                ? 'No projects are recorded in MeMCP yet.'
                : 'Projects are unavailable while MeMCP is not connected.'}
            </p>
          ) : (
            <div className={s.projectRow}>
              {state.priorityProjects.map(project => (
                <ProjectChip key={project.slug} project={project} />
              ))}
            </div>
          )}
        </Section>

        {/* 3. Recent meaningful work */}
        <Section title="Recent meaningful work" testId="recent-work">
          {state.recentWork.length === 0 ? (
            <p className={detailText}>
              Nothing has been recorded as a meaningful change yet. Reads and
              polling are excluded, so this stays empty until real work lands.
            </p>
          ) : (
            <ul className={s.changeList}>
              {state.recentWork.map(change => (
                <ChangeRow key={change.id} change={change} />
              ))}
            </ul>
          )}
        </Section>

        {/* 4. Needs you */}
        <Section title="Needs you" testId="needs-you">
          {state.needsYou.length === 0 ? (
            <p className={detailText}>
              Nothing needs your attention right now.
            </p>
          ) : (
            <ul className={s.blockerList}>
              {state.needsYou.map((blocker, index) => (
                <BlockerRow
                  key={`${blocker.source}-${index}`}
                  blocker={blocker}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** The continue-writing card, with the document bound once. */
function ContinueCard({
  document,
  onOpen,
}: {
  document: LabosHomeRepoDoc;
  onOpen: (rootId: string, relativePath: string) => void;
}) {
  return (
    <button
      type="button"
      className={s.continueCard}
      onClick={() => onOpen(document.rootId, document.relativePath)}
    >
      <span className={s.continuePath}>{document.relativePath}</span>
      <span className={s.continueMeta}>
        {document.rootLabel}
        {' · '}
        {describeWhen(document.lastOpenedAt)}
        {document.status === 'unsaved-draft' ? ' · unsaved draft' : ''}
        {document.status === 'conflict-review-needed'
          ? ' · conflict — review needed'
          : ''}
      </span>
    </button>
  );
}

function ProjectChip({ project }: { project: LabosHomeProject }) {  return (
    <article className={s.projectChip} data-pinned={project.pinned}>
      <h3 className={s.projectChipName}>{project.name}</h3>
      {project.summary ? (
        <p className={s.projectChipSummary}>{project.summary}</p>
      ) : (
        <p className={s.projectChipSummary}>No summary recorded.</p>
      )}
      <div className={projectMeta}>
        {/* A null status says so rather than looking like a healthy project. */}
        <span className={statusChip}>
          {project.status ?? 'No status recorded'}
        </span>
        <span className={statusChip}>
          {project.lastMeaningfulWorkAt
            ? describeWhen(project.lastMeaningfulWorkAt)
            : 'No work recorded'}
        </span>
      </div>
    </article>
  );
}

function ChangeRow({ change }: { change: LabosHomeChange }) {
  return (
    <li className={s.changeRow}>
      <div className={s.changeHeading}>
        <span className={s.changeTitle}>{change.title}</span>
        <span className={s.changeWhen}>{describeWhen(change.occurredAt)}</span>
      </div>
      <span className={evidenceDetail}>{change.summary}</span>
      {/* Provenance travels with the change so reported != verified. */}
      <span className={s.provenanceChip}>
        {change.provenance === 'verified_at_source'
          ? 'verified at source'
          : change.provenance}
      </span>
    </li>
  );
}

/** Blocker rows state the source, so the claim is attributable. */
function BlockerRow({ blocker }: { blocker: LabosHomeBlocker }) {
  const sourceLabel =
    blocker.source === 'memcp-task'
      ? 'Reported by MeMCP'
      : blocker.source === 'repo-document'
        ? 'From a repository document'
        : 'From a repository folder';

  return (
    <li className={s.blockerRow}>
      <div className={s.blockerHeading}>
        <span className={s.blockerTitle}>{blocker.title}</span>
        <span className={s.blockerSource}>{sourceLabel}</span>
      </div>
      <span className={evidenceDetail}>{blocker.detail}</span>
    </li>
  );
}

/** Shown when the sources could not be reached at all. */
export function LabosHomeUnavailable({ reason }: { reason: string }) {
  return (
    <div className={s.page}>
      <div className={emptyState}>
        <span className={notice}>{reason}</span>
      </div>
    </div>
  );
}

