/**
 * LabOS Workspace — /labos/projects page.
 *
 * The project workspace: gallery, sprint evidence, and a keyboard-accessible
 * reorderable shortlist.
 *
 * Presentation only. All the judgement about what the evidence means lives in
 * `sprint-model.ts`, which is tested separately; this file decides what to fetch
 * and where to put it.
 *
 * Honesty rules it must uphold:
 *  - a disconnected service shows "MeMCP not connected" or "Last received …",
 *    and cached data is visibly marked as cached
 *  - a project with no recorded status shows that, rather than defaulting to a
 *    plausible-looking one
 *  - the shortlist is stored in LabOS's own preferences keyed by slug, so it
 *    survives a restart and never reassigns a choice to a different project
 */

import { Button } from '@affine/component';
import { DesktopApiService } from '@affine/core/modules/desktop-api';
import {
  EMPTY_PREFERENCES,
  type LabosProjectPreferences,
  parsePreferences,
  toggleShortlist,
} from '@affine/core/modules/labos-repo/project-preferences';
import {
  applyShortlistOrder,
  buildProjectCover,
  buildSprintCards,
  type LabosProjectCard,
  lacksSprintStructure,
  moveItem,
} from '@affine/core/modules/labos-repo/sprint-model';
import {
  connectionBar,
  connectionChip,
  detail,
  detailSection,
  detailSectionTitle,
  detailText,
  emptyState,
  emptyTitle,
  header,
  main,
  notice,
  page,
  secondaryButton,
  title,
} from '@affine/core/modules/labos-repo/sprint-styles.css';
import {
  LabosGalleryLayout,
  LabosProjectGallery,
  LabosShortlist,
  LabosSprintList,
} from '@affine/core/modules/labos-repo/sprint-views';
import { useServiceOptional } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface MemcpProjectRow {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  category: string | null;
  summary: string | null;
  preview_url: string | null;
  cover_preview_id: string | null;
  updated_at: string;
  hasRepository: boolean;
  repositoryRemote: string | null;
}

interface MemcpSnapshot {
  project: {
    name: string;
    slug: string;
    status: string | null;
    summary: string | null;
    visual_evidence_mode: string;
    cover_preview_id: string | null;
  };
  sections: { latest_changes: { status: string; items: unknown[] } };
  tasks: {
    status_counts: Record<string, number>;
    total: number;
    items: unknown[];
  };
  evidence_gaps: { code: string; section: string; message: string }[];
}

interface MemcpHandler {
  connection: () => Promise<{
    connected: boolean;
    baseUrl: string;
    lastReceivedAt: string | null;
    lastError: { code: string; message: string } | null;
  }>;
  listProjects: () => Promise<
    | {
        ok: true;
        stale: false;
        projects: MemcpProjectRow[];
        receivedAt: string;
      }
    | {
        ok: false;
        stale: boolean;
        projects: MemcpProjectRow[];
        receivedAt: string | null;
        ageMs?: number;
        error: { code: string; message: string };
      }
  >;
  getProjectSnapshot: (input: { slug: string; force?: boolean }) => Promise<
    | {
        ok: true;
        kind: 'changed' | 'not-modified';
        snapshot: unknown;
        receivedAt: string;
      }
    | {
        ok: false;
        kind: 'cached' | 'unavailable';
        stale: boolean;
        snapshot: unknown | null;
        ageMs?: number | null;
        error: { code: string; message: string };
      }
  >;
}

/** Human-readable age, so "stale" comes with a number. */
function describeAge(ageMs: number | null | undefined): string {
  if (ageMs === null || ageMs === undefined) return '';
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const Component = () => {
  const desktopApi = useServiceOptional(DesktopApiService);
  const memcp = (
    desktopApi?.handler as { labosMemcp?: MemcpHandler } | undefined
  )?.labosMemcp;

  const [connection, setConnection] = useState<Awaited<
    ReturnType<MemcpHandler['connection']>
  > | null>(null);
  const [projects, setProjects] = useState<LabosProjectCard[]>([]);
  const [staleInfo, setStaleInfo] = useState<{
    error: string;
    ageMs?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MemcpSnapshot | null>(null);
  const [snapshotStale, setSnapshotStale] = useState<{
    error: string;
    ageMs?: number | null;
  } | null>(null);
  const [preferences, setPreferences] =
    useState<LabosProjectPreferences>(EMPTY_PREFERENCES);

  // --- preferences, loaded once from shared storage -------------------------

  useEffect(() => {
    const storage = desktopApi?.sharedStorage;
    if (!storage) return;
    let cancelled = false;
    // The shared state store hydrates asynchronously; reading before it is
    // ready would return nothing and look like a lost shortlist.
    storage.globalState.ready
      .then(() => {
        if (cancelled) return;
        const stored = storage.globalState.get<unknown>('labos-projects');
        setPreferences(parsePreferences(stored));
      })
      .catch(() => {
        // A failed preference read must not block the view; defaults are fine.
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const persistPreferences = useCallback(
    (next: LabosProjectPreferences) => {
      setPreferences(next);
      try {
        desktopApi?.sharedStorage.globalState.set('labos-projects', next);
      } catch {
        // Losing a preference write is not worth interrupting the reader for.
      }
    },
    [desktopApi]
  );

  // --- data ------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (!memcp) return;
    setLoading(true);
    try {
      const result = await memcp.listProjects();
      setConnection(await memcp.connection());

      if (result.ok) {
        setError(null);
        setStaleInfo(null);
        setProjects(
          result.projects.map(row => toProjectCard(row, 'live', null))
        );
      } else if (result.stale && result.projects.length > 0) {
        // Cached data is shown, but explicitly labelled as cached and aged.
        setError(null);
        setStaleInfo({
          error: result.error.message,
          ageMs: result.ageMs,
        });
        setProjects(
          result.projects.map(row => toProjectCard(row, 'cached', null))
        );
      } else {
        setError(result.error.message);
        setStaleInfo(null);
        setProjects([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [memcp]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const openProject = useCallback(
    async (slug: string) => {
      if (!memcp) return;
      setActiveSlug(slug);
      setSnapshot(null);
      setSnapshotStale(null);
      const result = await memcp.getProjectSnapshot({ slug });
      if (result.ok) {
        setSnapshot(result.snapshot as MemcpSnapshot);
        setSnapshotStale(null);
      } else if (result.snapshot) {
        setSnapshot(result.snapshot as MemcpSnapshot);
        setSnapshotStale({ error: result.error.message, ageMs: result.ageMs });
      } else {
        setSnapshot(null);
        setSnapshotStale({ error: result.error.message });
      }
      setConnection(await memcp.connection());
    },
    [memcp]
  );

  // --- shortlist --------------------------------------------------------------

  const ordered = useMemo(
    () => applyShortlistOrder(projects, preferences.shortlist),
    [projects, preferences.shortlist]
  );

  const shortlistItems = useMemo(() => {
    const bySlug = new Map(projects.map(project => [project.slug, project]));
    return preferences.shortlist
      .map(slug => bySlug.get(slug))
      .filter((project): project is LabosProjectCard => Boolean(project))
      .map(project => ({ slug: project.slug, name: project.name }));
  }, [projects, preferences.shortlist]);

  const handleMove = useCallback(
    (slug: string, direction: 'up' | 'down') => {
      const order = preferences.shortlist;
      const index = order.indexOf(slug);
      if (index === -1) return;
      const target = direction === 'up' ? index - 1 : index + 1;
      persistPreferences({
        ...preferences,
        shortlist: moveItem(order, index, target),
      });
    },
    [preferences, persistPreferences]
  );

  const handleRemove = useCallback(
    (slug: string) => {
      persistPreferences(toggleShortlist(preferences, slug));
    },
    [preferences, persistPreferences]
  );

  // --- render ------------------------------------------------------------------

  if (!memcp) {
    return (
      <div className={page}>
        <div className={emptyState}>
          <span className={emptyTitle}>Projects need the desktop app</span>
          <span>
            LabOS reads project information from MeMCP through a local service
            only available in the installed app.
          </span>
        </div>
      </div>
    );
  }

  if (activeSlug && snapshot) {
    const cards = buildSprintCards(snapshot as never);
    const structured = !lacksSprintStructure(snapshot as never);
    return (
      <div className={page}>
        <header className={header}>
          <Button
            variant="plain"
            onClick={() => {
              setActiveSlug(null);
              setSnapshot(null);
            }}
          >
            ← All projects
          </Button>
          <h1 className={title}>{snapshot.project.name}</h1>
        </header>
        <div className={main}>
          <div className={detail}>
            {snapshotStale ? (
              <p className={notice} role="status">
                <span aria-hidden="true">▪</span>
                <span>
                  MeMCP is not connected. Showing the last received snapshot
                  {snapshotStale.ageMs != null
                    ? ` from ${describeAge(snapshotStale.ageMs)}`
                    : ''}
                  . {snapshotStale.error}
                </span>
              </p>
            ) : null}

            <section className={detailSection}>
              <h2 className={detailSectionTitle}>Purpose</h2>
              <p className={detailText}>
                {snapshot.project.summary ??
                  'No explicit project summary has been recorded.'}
              </p>
            </section>

            <section className={detailSection}>
              <h2 className={detailSectionTitle}>Sprints and tasks</h2>
              <LabosSprintList cards={cards} structured={structured} />
            </section>

            <section className={detailSection}>
              <h2 className={detailSectionTitle}>What is not recorded</h2>
              {snapshot.evidence_gaps.length === 0 ? (
                <p className={detailText}>
                  MeMCP reports no evidence gaps for this project.
                </p>
              ) : (
                <ul className={detailText}>
                  {snapshot.evidence_gaps.map(gap => (
                    <li key={gap.code}>{gap.message}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={page}>
      <header className={header}>
        <h1 className={title}>Projects</h1>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            refresh().catch(() => {});
          }}
        >
          Refresh
        </button>
        <div className={connectionBar}>
          <ConnectionLabel connection={connection} staleInfo={staleInfo} />
        </div>
      </header>

      <div className={main}>
        {error ? (
          <p className={notice} role="status">
            <span aria-hidden="true">▪</span>
            <span>MeMCP not connected. {error}</span>
          </p>
        ) : null}

        {loading && projects.length === 0 ? (
          <p className={detailText}>Reading projects from MeMCP…</p>
        ) : (
          <LabosGalleryLayout
            shortlist={
              <LabosShortlist
                items={shortlistItems}
                onMove={handleMove}
                onRemove={handleRemove}
              />
            }
          >
            <LabosProjectGallery
              projects={ordered}
              onOpen={slug => {
                openProject(slug).catch(() => {});
              }}
            />
          </LabosGalleryLayout>
        )}
      </div>
    </div>
  );
};

/** Connection state is always stated in words. */
function ConnectionLabel({
  connection,
  staleInfo,
}: {
  connection: {
    connected: boolean;
    lastReceivedAt: string | null;
  } | null;
  staleInfo: { error: string; ageMs?: number } | null;
}) {
  if (!connection) return <span>Checking MeMCP…</span>;
  if (staleInfo) {
    return (
      <span className={connectionChip.stale}>
        Last received {describeAge(staleInfo.ageMs)} · not connected
      </span>
    );
  }
  if (connection.connected) {
    return <span className={connectionChip.connected}>MeMCP connected</span>;
  }
  return (
    <span className={connectionChip.disconnected}>MeMCP not connected</span>
  );
}

/** Convert a list row into a gallery card, honestly. */
function toProjectCard(
  row: MemcpProjectRow,
  dataState: 'live' | 'cached' | 'unavailable',
  snapshot: MemcpSnapshot | null
): LabosProjectCard {
  return {
    slug: row.slug,
    name: row.name,
    status: row.status,
    category: row.category,
    summary: row.summary,
    hasRepository: row.hasRepository,
    repositoryRemote: row.repositoryRemote,
    cover: buildProjectCover({
      previewUrl: row.preview_url,
      coverPreviewId: row.cover_preview_id,
      visualEvidenceMode: snapshot?.project.visual_evidence_mode ?? 'unknown',
      slug: row.slug,
    }),
    updatedAt: row.updated_at,
    taskCounts: snapshot?.tasks.status_counts ?? null,
    totalTasks: snapshot?.tasks.total ?? null,
    gaps: snapshot?.evidence_gaps ?? [],
    dataState,
  };
}
