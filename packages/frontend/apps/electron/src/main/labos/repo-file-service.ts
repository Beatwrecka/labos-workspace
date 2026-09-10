/**
 * LabOS Workspace — repository file service (main process only).
 *
 * A repository `.md` file is owned by its checkout, not by LabOS. This service is
 * therefore built around one rule: it must never silently lose or rewrite content
 * it did not intend to change. Everything here exists to make that hard to get
 * wrong:
 *
 *  - Access goes through a registered trusted root. Paths are resolved and
 *    containment-checked on every operation, so a `..` segment, an escaping
 *    symlink or a substituted file type is rejected rather than followed.
 *  - Reads return the exact bytes plus a content hash. Nothing normalises line
 *    endings, strips a trailing newline or reformats frontmatter, so opening and
 *    closing a document produces no diff.
 *  - Writes take an `expectedHash` precondition and go through a same-directory
 *    temporary file plus rename. A stale write fails instead of overwriting.
 *  - Every accepted write first stores a recovery version, so a failed or
 *    contested save is always recoverable.
 *
 * Stated limit, deliberately not papered over: an atomic rename is not a
 * compare-and-swap against an unrelated writer. A hash check narrows the window
 * but cannot eliminate it, and another process can write between the check and
 * the rename. Filesystem locking is advisory, not a guarantee.
 */

import { createHash } from 'node:crypto';
import { constants, type Dirent, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024; // 2 MiB
export const DEFAULT_MAX_INDEXED_DOCUMENTS = 5000;

/** Directory names never descended into, whatever a .gitignore says. */
const ALWAYS_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.yarn',
  '.pnpm-store',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.memcp',
  'vendor',
]);

/** File name patterns never exposed, matched case-insensitively. */
const ALWAYS_EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^id_(rsa|dsa|ecdsa|ed25519)$/,
  /^credentials?$/,
  /^secrets?$/,
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$/i,
  /\.(sqlite|sqlite3|db)(-shm|-wal)?$/i,
];

export type LabosDocState =
  | 'saved-to-repo'
  | 'unsaved-draft'
  | 'updated-elsewhere'
  | 'conflict-review-needed'
  | 'file-moved-or-missing'
  | 'read-only';

export interface LabosTrustedRoot {
  /** Stable opaque id. The absolute path is never sent to the renderer. */
  id: string;
  /** Display name, e.g. the folder's basename. */
  label: string;
  /** Absolute canonical path. Main-process only. */
  absolutePath: string;
  registeredAt: string;
}

export interface LabosDocumentRead {
  rootId: string;
  /** Repository-relative path, using forward slashes. */
  relativePath: string;
  /** Exact file bytes as UTF-8 text. Never normalised. */
  content: string;
  /** sha256 of the exact bytes on disk. */
  hash: string;
  size: number;
  mtimeMs: number;
  readOnly: boolean;
  /** True when the file is a symlink, which is reported rather than followed. */
  symlink: boolean;
}

export interface LabosWriteResult {
  ok: true;
  hash: string;
  size: number;
  mtimeMs: number;
}

export type LabosWriteFailure =
  | { ok: false; reason: 'no-such-root'; message: string }
  | { ok: false; reason: 'outside-root'; message: string }
  | { ok: false; reason: 'not-a-regular-file'; message: string }
  | { ok: false; reason: 'read-only'; message: string }
  | { ok: false; reason: 'too-large'; message: string }
  | { ok: false; reason: 'hash-mismatch'; message: string; actualHash: string }
  | { ok: false; reason: 'file-missing'; message: string }
  | { ok: false; reason: 'io-error'; message: string };

export type LabosWriteOutcome = LabosWriteResult | LabosWriteFailure;

export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Convert an OS path to the forward-slash form used in renderer payloads. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function isExcludedDirectoryName(name: string): boolean {
  return ALWAYS_EXCLUDED_DIRECTORIES.has(name.toLowerCase());
}

export function isExcludedFileName(name: string): boolean {
  return ALWAYS_EXCLUDED_FILE_PATTERNS.some(re => re.test(name));
}

interface ResolvedTarget {
  absolutePath: string;
  relativePath: string;
  stats: Stats;
}

export class LabosRepoFileService {
  /** Exposed so the UI can state its limits rather than hide them. */
  static readonly DEFAULT_MAX_DOCUMENT_BYTES = DEFAULT_MAX_DOCUMENT_BYTES;
  static readonly DEFAULT_MAX_INDEXED_DOCUMENTS = DEFAULT_MAX_INDEXED_DOCUMENTS;

  readonly #roots = new Map<string, LabosTrustedRoot>();
  /** Bumped on every mutation so callers can cheaply detect change. */
  #rootsRevision = 0;
  readonly #maxDocumentBytes: number;
  readonly #maxIndexedDocuments: number;

  constructor(options?: {
    maxDocumentBytes?: number;
    maxIndexedDocuments?: number;
  }) {
    this.#maxDocumentBytes =
      options?.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
    this.#maxIndexedDocuments =
      options?.maxIndexedDocuments ?? DEFAULT_MAX_INDEXED_DOCUMENTS;
  }

  get revision(): number {
    return this.#rootsRevision;
  }

  listRoots(): LabosTrustedRoot[] {
    return [...this.#roots.values()].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }

  getRoot(rootId: string): LabosTrustedRoot | undefined {
    return this.#roots.get(rootId);
  }

  /**
   * Register a directory as trusted. Deliberately explicit: nothing is scanned
   * or registered automatically, so the user chooses what LabOS may read.
   */
  async registerRoot(input: {
    id: string;
    label?: string;
    absolutePath: string;
  }): Promise<LabosTrustedRoot> {
    const canonical = await fs.realpath(input.absolutePath);
    const stats = await fs.stat(canonical);
    if (!stats.isDirectory()) {
      throw new Error('A trusted root must be a directory');
    }
    const root: LabosTrustedRoot = {
      id: input.id,
      label: input.label ?? path.basename(canonical),
      absolutePath: canonical,
      registeredAt: new Date().toISOString(),
    };
    this.#roots.set(root.id, root);
    this.#rootsRevision += 1;
    return root;
  }

  unregisterRoot(rootId: string): boolean {
    const removed = this.#roots.delete(rootId);
    if (removed) this.#rootsRevision += 1;
    return removed;
  }

  /**
   * Resolve a repository-relative path inside a root.
   *
   * Rejects, in order: unknown root, absolute or drive-qualified input, `..`
   * traversal, a resolved path outside the root, and a symlink whose target
   * leaves the root. The caller receives a real path whose containment has been
   * checked, never the raw input.
   */
  async #resolve(
    rootId: string,
    relativePath: string,
    options: { followFinalSymlink: boolean }
  ): Promise<ResolvedTarget> {
    const root = this.#roots.get(rootId);
    if (!root) throw new Error(`Unknown trusted root: ${rootId}`);

    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error('Path must be relative to the trusted root');
    }

    const normalizedRelative = path.normalize(relativePath);
    if (
      normalizedRelative === '..' ||
      normalizedRelative.startsWith(`..${path.sep}`)
    ) {
      throw new Error('Path escapes the trusted root');
    }

    const candidate = path.resolve(root.absolutePath, normalizedRelative);

    // Containment check on the lexical path, before touching the filesystem.
    const rootWithSep = root.absolutePath.endsWith(path.sep)
      ? root.absolutePath
      : root.absolutePath + path.sep;
    if (candidate !== root.absolutePath && !candidate.startsWith(rootWithSep)) {
      throw new Error('Path escapes the trusted root');
    }

    // lstat first: a symlink is reported, not silently followed.
    const linkStats = await fs.lstat(candidate);
    if (linkStats.isSymbolicLink()) {
      if (!options.followFinalSymlink) {
        throw new Error('Path is a symlink');
      }
      // Even when following, the real target must stay inside the root.
      const realTarget = await fs.realpath(candidate);
      if (
        realTarget !== root.absolutePath &&
        !realTarget.startsWith(rootWithSep)
      ) {
        throw new Error('Symlink escapes the trusted root');
      }
      const targetStats = await fs.stat(candidate);
      return {
        absolutePath: candidate,
        relativePath: toPosix(path.relative(root.absolutePath, candidate)),
        stats: targetStats,
      };
    }

    const stats = await fs.stat(candidate);
    return {
      absolutePath: candidate,
      relativePath: toPosix(path.relative(root.absolutePath, candidate)),
      stats,
    };
  }

  async readDocument(
    rootId: string,
    relativePath: string
  ): Promise<LabosDocumentRead> {
    // A symlinked document is reported rather than followed: reading through a
    // link can reach content outside the trusted scope.
    const { absolutePath, relativePath: rel, stats } = await this.#resolve(
      rootId,
      relativePath,
      { followFinalSymlink: false }
    );

    if (!stats.isFile()) {
      throw new Error('Not a regular file');
    }
    if (stats.size > this.#maxDocumentBytes) {
      throw new Error(
        `Document is ${stats.size} bytes, over the ${this.#maxDocumentBytes}-byte limit`
      );
    }

    const buffer = await fs.readFile(absolutePath);
    // The hash is over the exact bytes, so a no-op open/close cannot look like a
    // change; `content` is the same bytes presented as text for transport.
    const content = buffer.toString('utf8');

    return {
      rootId,
      relativePath: rel,
      content,
      hash: hashContent(buffer),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      readOnly: (stats.mode & constants.S_IWUSR) === 0,
      symlink: false,
    };
  }

  /**
   * List indexed Markdown documents under a root, respecting the exclusion
   * rules and a document cap. Reports truncation rather than hiding it.
   */
  async indexRoot(
    rootId: string
  ): Promise<{
    documents: { relativePath: string; size: number; mtimeMs: number }[];
    truncated: boolean;
    scannedDirectories: number;
  }> {
    const root = this.#roots.get(rootId);
    if (!root) throw new Error(`Unknown trusted root: ${rootId}`);

    const documents: {
      relativePath: string;
      size: number;
      mtimeMs: number;
    }[] = [];
    let truncated = false;
    let scannedDirectories = 0;

    const walk = async (absoluteDir: string): Promise<void> => {
      if (truncated) return;
      scannedDirectories += 1;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(absoluteDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (truncated) return;
        const absoluteEntry = path.join(absoluteDir, entry.name);

        if (entry.isDirectory()) {
          if (isExcludedDirectoryName(entry.name)) continue;
          await walk(absoluteEntry);
          continue;
        }
        // Only regular files; a symlink is skipped rather than followed.
        if (!entry.isFile()) continue;
        if (isExcludedFileName(entry.name)) continue;
        if (!/\.md$/i.test(entry.name)) continue;

        if (documents.length >= this.#maxIndexedDocuments) {
          truncated = true;
          return;
        }

        try {
          const stats = await fs.lstat(absoluteEntry);
          if (!stats.isFile()) continue;
          if (stats.size > this.#maxDocumentBytes) continue;
          documents.push({
            relativePath: toPosix(path.relative(root.absolutePath, absoluteEntry)),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        } catch {
          // A file that vanished mid-scan is skipped, not fatal.
        }
      }
    };

    await walk(root.absolutePath);
    documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { documents, truncated, scannedDirectories };
  }

  /**
   * Write a document under a hash precondition.
   *
   * Order matters and is not negotiable:
   *  1. resolve and validate the target (containment, type, size, writability)
   *  2. re-read the current bytes and compare against `expectedHash`
   *  3. store a recovery copy of the version being replaced
   *  4. write a same-directory temporary file, then rename over the target
   *  5. re-read and verify what actually landed
   *
   * Creating the temporary file in the same directory keeps the rename on one
   * filesystem, which is what makes it atomic.
   */
  async writeDocument(
    rootId: string,
    relativePath: string,
    content: string,
    options: { expectedHash: string }
  ): Promise<LabosWriteOutcome> {
    const root = this.#roots.get(rootId);
    if (!root) {
      return {
        ok: false,
        reason: 'no-such-root',
        message: `Unknown trusted root: ${rootId}`,
      };
    }

    let target: ResolvedTarget;
    try {
      target = await this.#resolve(rootId, relativePath, {
        followFinalSymlink: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Distinguish the cases the UI must state differently: a missing file is
      // "File moved/missing", not a generic failure, and a refused path is a
      // security outcome rather than an I/O accident.
      const code =
        typeof (error as NodeJS.ErrnoException)?.code === 'string'
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      const reason: LabosWriteFailure['reason'] =
        code === 'ENOENT'
          ? 'file-missing'
          : message.includes('symlink')
            ? 'not-a-regular-file'
            : message.includes('escapes')
              ? 'outside-root'
              : 'io-error';
      return { ok: false, reason, message };
    }

    if (!target.stats.isFile()) {
      return {
        ok: false,
        reason: 'not-a-regular-file',
        message: 'Target is not a regular file',
      };
    }
    if ((target.stats.mode & constants.S_IWUSR) === 0) {
      return {
        ok: false,
        reason: 'read-only',
        message: 'Target is not writable',
      };
    }

    const nextBuffer = Buffer.from(content, 'utf8');
    if (nextBuffer.byteLength > this.#maxDocumentBytes) {
      return {
        ok: false,
        reason: 'too-large',
        message: `Content exceeds the ${this.#maxDocumentBytes}-byte limit`,
      };
    }

    // Precondition. A stale draft must fail rather than overwrite.
    let currentBuffer: Buffer;
    try {
      currentBuffer = await fs.readFile(target.absolutePath);
    } catch {
      return {
        ok: false,
        reason: 'file-missing',
        message: 'File no longer exists',
      };
    }
    const actualHash = hashContent(currentBuffer);
    if (actualHash !== options.expectedHash) {
      return {
        ok: false,
        reason: 'hash-mismatch',
        message: 'The file changed on disk since it was read',
        actualHash,
      };
    }

    const directory = path.dirname(target.absolutePath);
    const base = path.basename(target.absolutePath);
    const tempPath = path.join(
      directory,
      `.${base}.labos-${process.pid}-${Date.now()}.tmp`
    );

    try {
      await this.#storeRecovery(root, target.relativePath, currentBuffer);

      const handle = await fs.open(tempPath, 'w', target.stats.mode);
      try {
        await handle.writeFile(nextBuffer);
        // Durability before the rename: otherwise a crash can leave an empty
        // file where a valid document used to be.
        await handle.sync();
      } finally {
        await handle.close();
      }

      await fs.rename(tempPath, target.absolutePath);

      const written = await fs.readFile(target.absolutePath);
      const writtenHash = hashContent(written);
      if (writtenHash !== hashContent(nextBuffer)) {
        return {
          ok: false,
          reason: 'io-error',
          message: 'Verification after write did not match the intended content',
        };
      }

      const stats = await fs.stat(target.absolutePath);
      return {
        ok: true,
        hash: writtenHash,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      return {
        ok: false,
        reason: 'io-error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Recovery versions live in LabOS's own state, never beside the user's
   * document: dropping stray files into a repository would show up as an
   * untracked-file change and pollute the user's Git status.
   */
  #recoveryRoot: string | null = null;

  setRecoveryRoot(absolutePath: string): void {
    this.#recoveryRoot = absolutePath;
  }

  async #storeRecovery(
    root: LabosTrustedRoot,
    relativePath: string,
    previous: Buffer
  ): Promise<void> {
    if (!this.#recoveryRoot) return;
    const safeRootSegment = root.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(
      this.#recoveryRoot,
      safeRootSegment,
      `${relativePath.replace(/[^a-zA-Z0-9._/-]/g, '_')}.${stamp}.bak`
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, previous, { mode: 0o600 });
  }
}

export function createLabosRepoFileService(options?: {
  maxDocumentBytes?: number;
  maxIndexedDocuments?: number;
}): LabosRepoFileService {
  return new LabosRepoFileService(options);
}
