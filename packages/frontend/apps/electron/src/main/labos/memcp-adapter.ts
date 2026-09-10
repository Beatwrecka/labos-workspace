/**
 * LabOS Workspace — MeMCP adapter (main process only).
 *
 * Independently written against MeMCP's observed HTTP contract. It does NOT
 * import MeMCP's packages: LabOS must not couple itself to another project's
 * internals, and MeMCP must stay free to change them.
 *
 * Verified contract this targets (read from the local checkout):
 *   GET /api/v1/health
 *   GET /api/v1/projects
 *   GET /api/v1/projects/:slug/snapshot   (ETag / If-None-Match, 304 supported)
 *
 * Deliberate behaviours, each matching something the contract actually does:
 *
 *  - **Loopback only.** The base URL must be numeric 127.0.0.1 HTTP. MeMCP
 *    validates this itself; rejecting it here too means a misconfiguration
 *    cannot quietly point LabOS at a remote host.
 *  - **No redirects.** A redirect is refused rather than followed, so a
 *    compromised or misconfigured local service cannot bounce LabOS elsewhere.
 *  - **Bounded responses.** A response over the limit is an error, not a
 *    truncated parse.
 *  - **Conditional reads.** The snapshot carries a strong ETag (the source
 *    fingerprint). Sending `If-None-Match` and handling 304 explicitly avoids
 *    re-parsing an unchanged snapshot, and — importantly — avoids treating an
 *    empty 304 body as a JSON parse failure.
 *  - **Authoritative freshness.** LabOS records when IT last received data, so a
 *    cached snapshot is visibly stale rather than presented as current.
 *
 * What this adapter must never do: invent project data. A missing field stays
 * missing, and an unreachable service is reported as disconnected.
 */

export type LabosMemcpErrorCode =
  | 'invalid-url'
  | 'invalid-response'
  | 'unavailable'
  | 'timeout'
  | 'redirect-rejected'
  | 'response-too-large'
  | 'not-found'
  | 'rejected';

export class LabosMemcpError extends Error {
  constructor(
    readonly code: LabosMemcpErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LabosMemcpError';
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Loopback, numeric, plain HTTP, no credentials, no query or fragment. */
export function validateMemcpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LabosMemcpError(
      'invalid-url',
      'The MeMCP address must be a numeric loopback HTTP URL.'
    );
  }
  const isLoopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    url.protocol !== 'http:' ||
    !isLoopback ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new LabosMemcpError(
      'invalid-url',
      'The MeMCP address must be a numeric loopback HTTP URL.'
    );
  }
  return url;
}

/** Read a response body with a hard byte ceiling. */
async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    throw new LabosMemcpError(
      'invalid-response',
      'MeMCP returned an empty response.'
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new LabosMemcpError(
          'response-too-large',
          'The MeMCP response was larger than LabOS will read.'
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

// --- response shapes we actually rely on -------------------------------------

export type LabosEvidenceSectionStatus = 'available' | 'partial' | 'unknown';
export type LabosProvenance =
  | 'explicit'
  | 'reported'
  | 'verified_at_source'
  | 'unknown';

/** A section is a report with its own honesty about what it can show. */
export interface LabosSnapshotSection<T> {
  status: LabosEvidenceSectionStatus;
  provenance: LabosProvenance;
  items: T[];
  omitted_count: number;
  note: string | null;
  text?: string | null;
  urls?: string[];
}

export interface LabosSnapshotTask {
  id: string;
  slug: string;
  title: string;
  status: 'planned' | 'in_progress' | 'blocked' | 'completed' | 'skipped';
  sprint_label: string | null;
  phase_title: string | null;
  updated_at: string;
  completed_at: string | null;
  source_path: string;
  source_sha: string | null;
  /**
   * MeMCP is explicit that these are REPORTED statuses, not verified outcomes.
   * LabOS must render the distinction rather than flattening it to "done".
   */
  evidence_label: 'reported_status' | 'reported_complete' | 'reported_blocked';
}

export interface LabosSnapshotChange {
  id: string;
  kind: 'git_commit' | 'task' | 'memory';
  title: string;
  summary: string;
  occurred_at: string;
  provenance: LabosProvenance;
  source_sha: string | null;
}

export interface LabosEvidenceGap {
  code: string;
  section: string;
  message: string;
}

export interface LabosSnapshot {
  schema_version: number;
  as_of: string;
  source_fingerprint: string;
  project: {
    id: string;
    name: string;
    slug: string;
    status: string | null;
    category: string | null;
    summary: string | null;
    next_action_override: string | null;
    visual_evidence_mode: string;
    cover_preview_id: string | null;
    repository: {
      binding: 'bound' | 'unbound';
      availability: string;
      remote: string | null;
    };
  };
  sections: {
    purpose: LabosSnapshotSection<unknown> & { text?: string | null };
    current_state: LabosSnapshotSection<unknown>;
    what_works: LabosSnapshotSection<LabosSnapshotTask>;
    blockers: LabosSnapshotSection<unknown>;
    latest_changes: LabosSnapshotSection<LabosSnapshotChange>;
    screenshots: LabosSnapshotSection<unknown> & { total?: number };
  };
  tasks: {
    status_counts: Record<string, number>;
    total: number;
    items: LabosSnapshotTask[];
    omitted_count: number;
  };
  resume_action: {
    type: 'task' | 'record_next_action';
    label: string;
    task_id: string | null;
    rule: string;
    provenance: LabosProvenance;
  };
  evidence_gaps: LabosEvidenceGap[];
  coverage: {
    accepted_memories: number;
    selected_memories: number;
    tracked_tasks: number;
    selected_tasks: number;
    meaningful_changes: number;
    selected_changes: number;
    visual_evidence: string;
  };
}

export interface LabosProjectSummary {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  category: string | null;
  summary: string | null;
  preview_url: string | null;
  cover_preview_id: string | null;
  updated_at: string;
  /** False when no repository is bound; LabOS shows that rather than guessing. */
  hasRepository: boolean;
  repositoryRemote: string | null;
}

export interface LabosMemcpHealth {
  status: string;
  archivist: string;
  archivist_enabled: boolean;
  queue: string;
  recovery_mode: boolean;
}

export interface LabosMemcpConnection {
  connected: boolean;
  baseUrl: string;
  /** When LabOS last successfully received data. Drives "Last received …". */
  lastReceivedAt: string | null;
  lastError: { code: LabosMemcpErrorCode; message: string } | null;
}

export interface LabosMemcpAdapterOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CacheEntry {
  etag: string;
  snapshot: LabosSnapshot;
  receivedAt: number;
}

/**
 * A snapshot fetch result that distinguishes "changed" from "not modified".
 *
 * Returning a discriminated union is what makes the 304 path impossible to
 * forget: there is no empty body to parse because there is no body.
 */
export type LabosSnapshotResult =
  | { kind: 'changed'; snapshot: LabosSnapshot; receivedAt: string }
  | { kind: 'not-modified'; snapshot: LabosSnapshot; receivedAt: string };

export class LabosMemcpAdapter {
  readonly #baseUrl: URL;
  readonly #baseUrlString: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();
  #connection: LabosMemcpConnection;
  #lastError: { code: LabosMemcpErrorCode; message: string } | null = null;
  #lastReceivedAt: number | null = null;

  constructor(options: LabosMemcpAdapterOptions) {
    this.#baseUrl = validateMemcpUrl(options.baseUrl);
    this.#baseUrlString = this.#baseUrl.toString().replace(/\/$/, '');
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => Date.now());
    this.#connection = {
      connected: false,
      baseUrl: this.#baseUrlString,
      lastReceivedAt: null,
      lastError: null,
    };
  }

  get baseUrl(): string {
    return this.#baseUrlString;
  }

  /** Current connection view. Never claims connected without evidence. */
  connection(): LabosMemcpConnection {
    return {
      ...this.#connection,
      lastReceivedAt:
        this.#lastReceivedAt === null
          ? null
          : new Date(this.#lastReceivedAt).toISOString(),
      lastError: this.#lastError,
    };
  }

  /** Drop cached snapshots, e.g. when the user changes the service address. */
  clearCache(): void {
    this.#cache.clear();
  }

  /** True when a cached snapshot for this project exists. */
  hasCachedSnapshot(slug: string): boolean {
    return this.#cache.has(slug);
  }

  /** Age of the newest successfully received data, in milliseconds. */
  cachedAgeMs(): number | null {
    if (this.#lastReceivedAt === null) return null;
    return this.#now() - this.#lastReceivedAt;
  }

  async #request(
    method: 'GET',
    path: string,
    options: { ifNoneMatch?: string; maxBytes?: number } = {}
  ): Promise<{ status: number; text: string; etag: string | null }> {
    if (!path.startsWith('/') || path.includes('//')) {
      throw new LabosMemcpError('invalid-response', 'Invalid MeMCP request path.');
    }
    const target = new URL(path, this.#baseUrl);
    if (target.origin !== this.#baseUrl.origin) {
      throw new LabosMemcpError('invalid-url', 'MeMCP request left the host.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;

      const response = await this.#fetch(target, {
        method,
        headers,
        // Never follow a redirect: a local service must not redirect LabOS.
        redirect: 'manual',
        signal: controller.signal,
      });

      // A 304 has no body by design and is a SUCCESS, not a redirect. It must be
      // handled before the 3xx rejection below, or every conditional read is
      // misreported as a redirect.
      if (response.status === 304) {
        return {
          status: 304,
          text: '',
          etag: response.headers.get('etag'),
        };
      }

      // Every other 3xx is refused: a local service must not redirect LabOS.
      if (response.status >= 300 && response.status < 400) {
        throw new LabosMemcpError(
          'redirect-rejected',
          'MeMCP returned a redirect, which LabOS does not follow.'
        );
      }

      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (contentType !== 'application/json') {
        throw new LabosMemcpError(
          'invalid-response',
          'MeMCP returned a response LabOS does not understand.'
        );
      }

      const text = await readBounded(
        response,
        options.maxBytes ?? MAX_RESPONSE_BYTES
      );

      if (response.status === 404) {
        throw new LabosMemcpError('not-found', 'MeMCP has no such record.');
      }
      if (!response.ok) {
        throw new LabosMemcpError(
          'rejected',
          'MeMCP rejected the request.'
        );
      }

      return { status: response.status, text, etag: response.headers.get('etag') };
    } catch (error) {
      if (error instanceof LabosMemcpError) throw error;
      if (controller.signal.aborted) {
        throw new LabosMemcpError(
          'timeout',
          'MeMCP did not respond before the LabOS timeout.'
        );
      }
      throw new LabosMemcpError('unavailable', 'MeMCP is not reachable.');
    } finally {
      clearTimeout(timeout);
    }
  }

  #parse<T>(text: string): T {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LabosMemcpError(
        'invalid-response',
        'MeMCP returned a response LabOS could not read.'
      );
    }
  }

  #recordSuccess(): void {
    this.#lastReceivedAt = this.#now();
    this.#lastError = null;
    this.#connection = {
      connected: true,
      baseUrl: this.#baseUrlString,
      lastReceivedAt: new Date(this.#lastReceivedAt).toISOString(),
      lastError: null,
    };
  }

  #recordFailure(error: unknown): never {
    const wrapped =
      error instanceof LabosMemcpError
        ? error
        : new LabosMemcpError('unavailable', 'MeMCP is not reachable.');
    this.#lastError = { code: wrapped.code, message: wrapped.message };
    this.#connection = {
      // A single failure means "not connected right now". Cached data may still
      // be shown, but it must be labelled as stale.
      connected: false,
      baseUrl: this.#baseUrlString,
      lastReceivedAt:
        this.#lastReceivedAt === null
          ? null
          : new Date(this.#lastReceivedAt).toISOString(),
      lastError: this.#lastError,
    };
    throw wrapped;
  }

  /** Health probe. Used to decide between "connected" and a disconnected state. */
  async health(): Promise<LabosMemcpHealth> {
    try {
      const { text } = await this.#request('GET', '/api/v1/health');
      const parsed = this.#parse<Partial<LabosMemcpHealth>>(text);
      this.#recordSuccess();
      return {
        status: parsed.status ?? 'unknown',
        archivist: parsed.archivist ?? 'unknown',
        archivist_enabled: Boolean(parsed.archivist_enabled),
        queue: parsed.queue ?? 'unknown',
        recovery_mode: Boolean(parsed.recovery_mode),
      };
    } catch (error) {
      this.#recordFailure(error);
    }
  }

  /**
   * List projects.
   *
   * Fields absent from MeMCP stay absent here. Nothing is defaulted to a
   * plausible-looking value, because a fabricated status is worse than a gap.
   */
  async listProjects(): Promise<LabosProjectSummary[]> {
    try {
      const { text } = await this.#request('GET', '/api/v1/projects');
      const parsed = this.#parse<{ projects?: unknown[] }>(text);
      const rows = Array.isArray(parsed.projects) ? parsed.projects : [];
      this.#recordSuccess();

      return rows
        .filter(
          (row): row is Record<string, unknown> =>
            typeof row === 'object' && row !== null
        )
        .map(row => {
          const repoPath = row.repo_path;
          const repoRemote = row.repo_remote;
          return {
            id: String(row.id ?? ''),
            name: String(row.name ?? ''),
            slug: String(row.slug ?? ''),
            status: row.status == null ? null : String(row.status),
            category: row.category == null ? null : String(row.category),
            summary: row.summary == null ? null : String(row.summary),
            preview_url: row.preview_url == null ? null : String(row.preview_url),
            cover_preview_id:
              row.cover_preview_id == null ? null : String(row.cover_preview_id),
            updated_at: String(row.updated_at ?? ''),
            hasRepository: Boolean(repoPath),
            repositoryRemote: repoRemote == null ? null : String(repoRemote),
          };
        })
        .filter(project => project.slug.length > 0);
    } catch (error) {
      this.#recordFailure(error);
    }
  }

  /**
   * Fetch a project snapshot, using a conditional request where possible.
   *
   * `force` bypasses the cache. A 304 returns the cached snapshot marked
   * `not-modified`, so the caller can update "last checked" without pretending
   * anything changed.
   */
  async getProjectSnapshot(
    slug: string,
    options: { force?: boolean } = {}
  ): Promise<LabosSnapshotResult> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new LabosMemcpError(
        'invalid-response',
        'A MeMCP project slug must be lowercase and hyphenated.'
      );
    }

    const cached = this.#cache.get(slug);
    const ifNoneMatch = !options.force && cached ? cached.etag : undefined;

    try {
      const response = await this.#request(
        'GET',
        `/api/v1/projects/${encodeURIComponent(slug)}/snapshot`,
        { ifNoneMatch }
      );

      if (response.status === 304) {
        if (!cached) {
          // A 304 without a cache should be impossible; treat it as a protocol
          // error rather than inventing a snapshot.
          throw new LabosMemcpError(
            'invalid-response',
            'MeMCP reported no change but LabOS holds no cached snapshot.'
          );
        }
        this.#recordSuccess();
        return {
          kind: 'not-modified',
          snapshot: cached.snapshot,
          receivedAt: new Date(this.#lastReceivedAt ?? this.#now()).toISOString(),
        };
      }

      const snapshot = this.#parse<LabosSnapshot>(response.text);
      this.#recordSuccess();

      const etag = response.etag ?? `"${snapshot.source_fingerprint}"`;
      this.#cache.set(slug, {
        etag,
        snapshot,
        receivedAt: this.#now(),
      });

      return {
        kind: 'changed',
        snapshot,
        receivedAt: new Date(this.#lastReceivedAt ?? this.#now()).toISOString(),
      };
    } catch (error) {
      this.#recordFailure(error);
    }
  }

  /** A cached snapshot, if one exists. Used to show stale data honestly. */
  cachedSnapshot(slug: string): LabosSnapshot | null {
    return this.#cache.get(slug)?.snapshot ?? null;
  }
}

export const MEMCP_DEFAULT_BASE_URL = 'http://127.0.0.1:3210';
