/**
 * LabOS Workspace — home screen page.
 *
 * Assembles the home state from the two real sources: MeMCP project data and the
 * repository documents LabOS knows about.
 *
 * Two honesty rules this page is responsible for:
 *  - a source that failed is reported as unavailable, and the OTHER half of the
 *    screen keeps working (the briefing requires notes and repo documents to
 *    work when MeMCP is down)
 *  - a document that has moved or gone missing is surfaced under "Needs you"
 *    rather than silently offered as "continue writing"
 */

import { DesktopApiService } from '@affine/core/modules/desktop-api';
import {
  buildHomeState,
  type LabosHomeChange,
  type LabosHomeProject,
  type LabosHomeRepoDoc,
} from '@affine/core/modules/labos-repo/home-model';
import { LabosHomeView } from '@affine/core/modules/labos-repo/home-view';
import { useServiceOptional } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface RepoHandler {
  listRoots: () => Promise<{ id: string; label: string }[]>;
  indexRoot: (rootId: string) => Promise<
    | { documents: { relativePath: string; size: number; mtimeMs: number }[] }
    | { code: string; message: string }
  >;
}

interface MemcpProjectRow {
  slug: string;
  name: string;
  summary: string | null;
  status: string | null;
  updated_at: string;
}

interface MemcpSnapshot {
  project: { slug: string; name: string; summary: string | null; status: string | null };
  sections: {
    latest_changes?: {
      items: {
        id: string;
        title: string;
        summary: string;
        occurred_at: string;
        provenance: string;
      }[];
    };
  };
  tasks?: { items: { title: string; status: string }[] };
}

interface MemcpHandler {
  connection: () => Promise<{ connected: boolean; lastReceivedAt: string | null }>;
  listProjects: () => Promise<
    | { ok: true; projects: MemcpProjectRow[] }
    | { ok: false; stale: boolean; projects: MemcpProjectRow[] }
  >;
  getProjectSnapshot: (input: { slug: string }) => Promise<
    | { ok: true; kind: 'changed' | 'not-modified'; snapshot: unknown }
    | { ok: false; kind: 'cached' | 'unavailable'; snapshot: unknown | null }
  >;
}

/** Where the reader's recently-opened documents are remembered. */
const RECENT_KEY = 'labos-recent-documents';
const MAX_RECENT_DOCS = 12;

interface RecentDocument {
  rootId: string;
  relativePath: string;
  lastOpenedAt: string;
}

export const Component = () => {
  const navigate = useNavigate();
  const desktopApi = useServiceOptional(DesktopApiService);
  const repo = (desktopApi?.handler as { labosRepo?: RepoHandler } | undefined)
    ?.labosRepo;
  const memcp = (desktopApi?.handler as { labosMemcp?: MemcpHandler } | undefined)
    ?.labosMemcp;

  const [repoDocuments, setRepoDocuments] = useState<LabosHomeRepoDoc[]>([]);
  const [unavailableRoots, setUnavailableRoots] = useState<
    { id: string; label: string }[]
  >([]);
  const [projects, setProjects] = useState<LabosHomeProject[]>([]);
  const [changes, setChanges] = useState<LabosHomeChange[]>([]);
  const [blocks, setBlocks] = useState<
    { task: string; detail: string; projectSlug: string }[]
  >([]);
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [memcpState, setMemcpState] = useState<
    'connected' | 'disconnected' | 'cached'
  >('disconnected');
  const [rootsRegistered, setRootsRegistered] = useState(0);

  // --- recently opened documents ------------------------------------------

  const loadRecentDocuments = useCallback(async () => {
    const storage = desktopApi?.sharedStorage;
    if (!storage) return [];
    try {
      await storage.globalState.ready;
      const stored = storage.globalState.get<unknown>(RECENT_KEY);
      if (!Array.isArray(stored)) return [];
      return stored
        .filter(
          (entry): entry is RecentDocument =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as RecentDocument).rootId === 'string' &&
            typeof (entry as RecentDocument).relativePath === 'string'
        )
        // Bounded so a long history does not grow the preference file without
        // limit; only the most recent are ever offered as "continue writing".
        .slice(0, MAX_RECENT_DOCS);
    } catch {
      return [];
    }
  }, [desktopApi]);

  const refresh = useCallback(async () => {
    // --- repository side ---
    if (repo) {
      try {
        const roots = await repo.listRoots();
        setRootsRegistered(roots.length);

        const recent = await loadRecentDocuments();
        const recentByKey = new Map(
          recent.map(entry => [
            `${entry.rootId}:${entry.relativePath}`,
            entry.lastOpenedAt,
          ])
        );

        const documents: LabosHomeRepoDoc[] = [];
        const unavailable: { id: string; label: string }[] = [];

        for (const root of roots) {
          const result = await repo.indexRoot(root.id);
          if ('code' in result) {
            // A folder that cannot be read is surfaced, not silently skipped.
            unavailable.push({ id: root.id, label: root.label });
            continue;
          }
          for (const document of result.documents) {
            const key = `${root.id}:${document.relativePath}`;
            const lastOpenedAt = recentByKey.get(key);
            // Only documents the reader has actually opened are offered as
            // "continue"; indexing a folder is not the same as reading a file.
            if (!lastOpenedAt) continue;
            documents.push({
              rootId: root.id,
              rootLabel: root.label,
              relativePath: document.relativePath,
              lastOpenedAt,
              status: null,
            });
          }
        }

        setRepoDocuments(documents);
        setUnavailableRoots(unavailable);
      } catch {
        setUnavailableRoots([]);
      }
    }

    // --- shortlist ---
    const storage = desktopApi?.sharedStorage;
    if (storage) {
      try {
        await storage.globalState.ready;
        const stored = storage.globalState.get<unknown>('labos-projects');
        if (
          stored &&
          typeof stored === 'object' &&
          Array.isArray((stored as { shortlist?: unknown }).shortlist)
        ) {
          setShortlist(
            ((stored as { shortlist: unknown[] }).shortlist ?? []).filter(
              (entry): entry is string => typeof entry === 'string'
            )
          );
        }
      } catch {
        // Preferences are optional; the home screen works without them.
      }
    }

    // --- MeMCP side ---
    if (!memcp) {
      setMemcpState('disconnected');
      return;
    }
    try {
      const result = await memcp.listProjects();
      const connection = await memcp.connection();

      if (!result.ok) {
        setMemcpState(result.stale ? 'cached' : 'disconnected');
        if (result.projects.length === 0) {
          setProjects([]);
          setChanges([]);
          setBlocks([]);
          return;
        }
      } else {
        setMemcpState('connected');
      }

      setProjects(
        result.projects.map(row => ({
          slug: row.slug,
          name: row.name,
          summary: row.summary,
          status: row.status,
          // MeMCP reports when the project row last changed; that is the closest
          // honest proxy for meaningful work available from the list endpoint.
          lastMeaningfulWorkAt: row.updated_at || null,
          pinned: false,
        }))
      );

      // Snapshots supply the real changes and blockers. Bounded to a few
      // projects so the home screen does not turn into a full poll.
      const collectedChanges: LabosHomeChange[] = [];
      const collectedBlocks: {
        task: string;
        detail: string;
        projectSlug: string;
      }[] = [];

      for (const row of result.projects.slice(0, 5)) {
        try {
          const snapshotResult = await memcp.getProjectSnapshot({
            slug: row.slug,
          });
          if (!snapshotResult.snapshot) continue;
          const snapshot = snapshotResult.snapshot as MemcpSnapshot;

          for (const change of snapshot.sections.latest_changes?.items ?? []) {
            collectedChanges.push({
              id: `${row.slug}:${change.id}`,
              title: change.title,
              summary: change.summary,
              occurredAt: change.occurred_at,
              provenance: change.provenance,
              projectSlug: row.slug,
            });
          }

          for (const task of snapshot.tasks?.items ?? []) {
            // Only a task MeMCP reports as blocked becomes a blocker. Nothing
            // is escalated by heuristic.
            if (task.status === 'blocked') {
              collectedBlocks.push({
                task: task.title,
                detail: 'Reported blocked by MeMCP.',
                projectSlug: row.slug,
              });
            }
          }
        } catch {
          // One project failing must not empty the whole home screen.
        }
      }

      setChanges(collectedChanges);
      setBlocks(collectedBlocks);
      if (!connection.connected && result.ok) {
        setMemcpState('disconnected');
      }
    } catch {
      setMemcpState('disconnected');
    }
  }, [repo, memcp, desktopApi, loadRecentDocuments]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const state = buildHomeState({
    repoDocuments,
    rootsRegistered,
    unavailableRoots,
    projects,
    shortlist,
    changes,
    blocks,
    memcp: memcpState,
  });

  return (
    <LabosHomeView
      state={state}
      onOpenDocument={() => {
        // Navigating rather than reloading: a full page load would discard the
        // app's in-memory state for no reason.
        navigate('/labos/repo');
      }}
      onOpenProjects={() => {
        navigate('/labos/projects');
      }}
      onOpenRepo={() => {
        navigate('/labos/repo');
      }}
    />
  );
};
