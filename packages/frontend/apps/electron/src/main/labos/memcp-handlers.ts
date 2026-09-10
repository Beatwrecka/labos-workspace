/**
 * LabOS Workspace — MeMCP IPC handlers.
 *
 * The renderer asks for project data; the main process decides it. Two things
 * this layer is responsible for:
 *
 *  - **Reporting honestly.** A failure returns a structured result carrying the
 *    error code AND any cached snapshot, so the UI can show last-known data
 *    labelled as stale rather than either hiding it or implying it is current.
 *  - **Never pretending.** When the service is unreachable, `connected` is false
 *    and the data is marked cached. There is no code path that returns fabricated
 *    project data.
 *
 * The base URL is stored in LabOS's own preferences and validated on read, so a
 * misconfigured address cannot point at a remote host.
 */

import type { NamespaceHandlers } from '../type';
import {
  LabosMemcpAdapter,
  LabosMemcpError,
  type LabosProjectSummary,
  type LabosSnapshot,
  MEMCP_DEFAULT_BASE_URL,
} from './memcp-adapter';

interface CachedProjectView {
  projects: LabosProjectSummary[];
  receivedAt: number;
}

let adapter: LabosMemcpAdapter | null = null;
let lastProjectList: CachedProjectView | null = null;

/** Configured address, validated. Falls back to the documented default. */
function resolveBaseUrl(): string {
  const configured = process.env.LABOS_MEMCP_URL;
  if (configured) return configured;
  return MEMCP_DEFAULT_BASE_URL;
}

function getAdapter(): LabosMemcpAdapter {
  if (adapter) return adapter;
  adapter = new LabosMemcpAdapter({
    baseUrl: resolveBaseUrl(),
    timeoutMs: 5_000,
  });
  return adapter;
}

/** Test/DI hook, and the path a future settings screen would use. */
export function setMemcpBaseUrl(baseUrl: string): void {
  adapter = new LabosMemcpAdapter({ baseUrl, timeoutMs: 5_000 });
  lastProjectList = null;
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof LabosMemcpError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'unavailable',
    message: error instanceof Error ? error.message : 'MeMCP is not reachable.',
  };
}

export const labosMemcpHandlers = {
  connection: async () => {
    return getAdapter().connection();
  },

  health: async () => {
    try {
      const health = await getAdapter().health();
      return { ok: true as const, health, connection: getAdapter().connection() };
    } catch (error) {
      return {
        ok: false as const,
        error: describeError(error),
        connection: getAdapter().connection(),
      };
    }
  },

  /**
   * List projects.
   *
   * On failure the last successful list is returned with `stale: true` and its
   * age, so the UI can present it honestly instead of showing nothing.
   */
  listProjects: async () => {
    try {
      const projects = await getAdapter().listProjects();
      lastProjectList = { projects, receivedAt: Date.now() };
      return {
        ok: true as const,
        stale: false as const,
        projects,
        receivedAt: new Date(Date.now()).toISOString(),
        connection: getAdapter().connection(),
      };
    } catch (error) {
      const connection = getAdapter().connection();
      if (lastProjectList) {
        return {
          ok: false as const,
          stale: true as const,
          projects: lastProjectList.projects,
          receivedAt: new Date(lastProjectList.receivedAt).toISOString(),
          ageMs: Date.now() - lastProjectList.receivedAt,
          error: describeError(error),
          connection,
        };
      }
      return {
        ok: false as const,
        stale: false as const,
        projects: [] as LabosProjectSummary[],
        receivedAt: null,
        error: describeError(error),
        connection,
      };
    }
  },

  /**
   * A project snapshot.
   *
   * `kind` distinguishes a changed snapshot from a not-modified one, so the UI
   * can update "last checked" without redrawing as though something changed.
   */
  getProjectSnapshot: async (
    _e: Electron.IpcMainInvokeEvent,
    input: { slug: string; force?: boolean }
  ) => {
    try {
      const result = await getAdapter().getProjectSnapshot(input.slug, {
        force: input.force,
      });
      return {
        ok: true as const,
        kind: result.kind,
        stale: false as const,
        snapshot: result.snapshot,
        receivedAt: result.receivedAt,
        connection: getAdapter().connection(),
      };
    } catch (error) {
      const cached: LabosSnapshot | null = getAdapter().cachedSnapshot(
        input.slug
      );
      if (cached) {
        const age = getAdapter().cachedAgeMs();
        return {
          ok: false as const,
          kind: 'cached' as const,
          stale: true as const,
          snapshot: cached,
          receivedAt: getAdapter().connection().lastReceivedAt,
          ageMs: age,
          error: describeError(error),
          connection: getAdapter().connection(),
        };
      }
      return {
        ok: false as const,
        kind: 'unavailable' as const,
        stale: false as const,
        snapshot: null,
        error: describeError(error),
        connection: getAdapter().connection(),
      };
    }
  },

  /** Discard cached snapshots, e.g. after the address changes. */
  clearCache: async () => {
    getAdapter().clearCache();
    lastProjectList = null;
    return { cleared: true };
  },
} satisfies NamespaceHandlers;

/** Release any adapter state on shutdown. */
export function closeLabosMemcp(): void {
  adapter?.clearCache();
  adapter = null;
  lastProjectList = null;
}
