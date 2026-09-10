/**
 * LabOS Workspace — repository watcher (main process only).
 *
 * External writers are the normal case here: an agent edits a file, VS Code
 * saves it, `git checkout` replaces it wholesale. The watcher's job is to notice
 * that reliably and report it, not to guess whether the change was "ours".
 *
 * Design notes, each one earned from a specific failure mode:
 *
 *  - Watch the DIRECTORY, not the file. Editors and agents commonly write a
 *    temporary file and rename it over the target, which orphans a file watch.
 *    A directory watch survives atomic replacement and sees rename/delete.
 *  - Debounce and coalesce. A single save can emit several events; reporting
 *    each one would make the UI flicker and could trigger a save loop.
 *  - Suppress self-writes by content hash, not by timing. The service knows the
 *    hash it just wrote; an event whose current hash matches is our own write.
 *    A time-based guard would be a race.
 *  - Treat the notification stream as advisory. Events can be dropped, coalesced
 *    or missed across sleep/wake, so reconciliation on focus, wake and startup is
 *    a required peer of this watcher rather than an optional extra.
 */

import type { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import path from 'node:path';

export type LabosFileChangeKind = 'modified' | 'renamed-or-replaced' | 'deleted';

export interface LabosFileChange {
  rootId: string;
  relativePath: string;
  kind: LabosFileChangeKind;
  /** Hash of the current content, or null when the file is gone. */
  hash: string | null;
  detectedAt: number;
}

export interface LabosWatcherOptions {
  /** Coalesce window. Rapid saves collapse into one notification. */
  debounceMs?: number;
  /** Resolve the current hash for a path, or null if it no longer exists. */
  resolveHash: (rootId: string, relativePath: string) => Promise<string | null>;
  /** Called once per coalesced change. */
  onChange: (change: LabosFileChange) => void;
}

interface WatchedRoot {
  rootId: string;
  absolutePath: string;
  watcher: FSWatcher;
  /** relativePath -> pending debounce timer. */
  pending: Map<string, NodeJS.Timeout>;
  /** relativePath -> last reported hash, so repeats are not re-reported. */
  lastReportedHash: Map<string, string | null>;
}

const DEFAULT_DEBOUNCE_MS = 150;

export class LabosRepoWatcher {
  readonly #roots = new Map<string, WatchedRoot>();
  readonly #options: Required<Pick<LabosWatcherOptions, 'debounceMs'>> &
    Omit<LabosWatcherOptions, 'debounceMs'>;
  #closed = false;

  constructor(options: LabosWatcherOptions) {
    this.#options = {
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      resolveHash: options.resolveHash,
      onChange: options.onChange,
    };
  }

  get watchedRootIds(): string[] {
    return [...this.#roots.keys()];
  }

  watchRoot(rootId: string, absolutePath: string): void {
    if (this.#closed) throw new Error('Watcher is closed');
    if (this.#roots.has(rootId)) return;

    const pending = new Map<string, NodeJS.Timeout>();
    const lastReportedHash = new Map<string, string | null>();

    // `recursive` is supported on macOS and Windows; on Linux it throws, in
    // which case a non-recursive watch still covers top-level documents and the
    // reconciliation path covers the rest. Failing the whole feature because one
    // platform cannot recurse would be the wrong trade.
    let watcher: FSWatcher;
    try {
      watcher = watch(absolutePath, { recursive: true, persistent: false });
    } catch {
      watcher = watch(absolutePath, { persistent: false });
    }

    watcher.on('error', () => {
      // A watcher error must not take the app down; reconciliation will catch
      // whatever was missed.
    });

    watcher.on('change', (_eventType, filename) => {
      if (!filename) return;
      const relativePath = String(filename).split(path.sep).join('/');
      this.#schedule(rootId, relativePath);
    });

    this.#roots.set(rootId, {
      rootId,
      absolutePath,
      watcher,
      pending,
      lastReportedHash,
    });
  }

  unwatchRoot(rootId: string): void {
    const entry = this.#roots.get(rootId);
    if (!entry) return;
    for (const timer of entry.pending.values()) clearTimeout(timer);
    entry.pending.clear();
    entry.watcher.close();
    this.#roots.delete(rootId);
  }

  /**
   * Record the hash the app itself just wrote, so the resulting filesystem event
   * is recognised as self-generated rather than reported as an external change.
   */
  noteSelfWrite(rootId: string, relativePath: string, hash: string): void {
    const entry = this.#roots.get(rootId);
    if (!entry) return;
    entry.lastReportedHash.set(relativePath, hash);
  }

  #schedule(rootId: string, relativePath: string): void {
    const entry = this.#roots.get(rootId);
    if (!entry) return;

    const existing = entry.pending.get(relativePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      entry.pending.delete(relativePath);
      // A failed report must not become an unhandled rejection; the change is
      // simply not announced, and reconciliation will find it later.
      this.#report(rootId, relativePath).catch(() => {});
    }, this.#options.debounceMs);

    // Do not hold the process open for a debounce timer.
    if (typeof timer.unref === 'function') timer.unref();
    entry.pending.set(relativePath, timer);
  }

  async #report(rootId: string, relativePath: string): Promise<void> {
    const entry = this.#roots.get(rootId);
    if (!entry || this.#closed) return;

    let hash: string | null;
    try {
      hash = await this.#options.resolveHash(rootId, relativePath);
    } catch {
      hash = null;
    }

    const previous = entry.lastReportedHash.get(relativePath);
    const hadPrevious = entry.lastReportedHash.has(relativePath);
    // Self-write suppression by content, not by clock.
    if (hadPrevious && previous === hash) return;
    entry.lastReportedHash.set(relativePath, hash);

    const kind: LabosFileChangeKind =
      hash === null
        ? 'deleted'
        : hadPrevious && previous !== null
          ? 'modified'
          : 'renamed-or-replaced';

    this.#options.onChange({
      rootId,
      relativePath,
      kind,
      hash,
      detectedAt: Date.now(),
    });
  }

  /**
   * Re-read the current hash for a path and report a change if it differs from
   * what was last seen. Called on window focus, after wake and at startup,
   * because the event stream alone cannot be trusted across those boundaries.
   */
  async reconcile(
    rootId: string,
    relativePath: string
  ): Promise<LabosFileChange | null> {
    const entry = this.#roots.get(rootId);
    if (!entry) return null;

    let hash: string | null;
    try {
      hash = await this.#options.resolveHash(rootId, relativePath);
    } catch {
      hash = null;
    }

    const hadPrevious = entry.lastReportedHash.has(relativePath);
    const previous = entry.lastReportedHash.get(relativePath);
    if (hadPrevious && previous === hash) return null;
    entry.lastReportedHash.set(relativePath, hash);

    return {
      rootId,
      relativePath,
      kind:
        hash === null
          ? 'deleted'
          : hadPrevious && previous !== null
            ? 'modified'
            : 'renamed-or-replaced',
      hash,
      detectedAt: Date.now(),
    };
  }

  close(): void {
    this.#closed = true;
    // Snapshot the ids first: unwatchRoot mutates #roots while we iterate.
    const rootIds = Array.from(this.#roots.keys());
    for (const rootId of rootIds) this.unwatchRoot(rootId);
  }
}
