/**
 * LabOS Workspace — trusted root persistence (main process only).
 *
 * Root registrations must survive a restart, but the absolute paths are private
 * machine configuration: they belong in LabOS's own userData, never in the
 * repository, never in a commit, and never in a log.
 *
 * The file is treated as untrusted input on read. A corrupt or hand-edited entry
 * is skipped rather than allowed to register something unexpected, and a path
 * that has since moved is marked unavailable instead of being silently retried
 * forever.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface LabosPersistedRoot {
  id: string;
  label: string;
  absolutePath: string;
  /** Set when the directory could not be reached at startup. */
  unavailableAt?: string;
}

interface LabosRootFile {
  version: 1;
  roots: LabosPersistedRoot[];
}

const FILE_NAME = 'labos-trusted-roots.json';

export class LabosRootStore {
  readonly #resolveUserData: () => string;

  constructor(resolveUserData: () => string) {
    this.#resolveUserData = resolveUserData;
  }

  #filePath(): string {
    return path.join(this.#resolveUserData(), FILE_NAME);
  }

  async load(): Promise<LabosPersistedRoot[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.#filePath(), 'utf8');
    } catch {
      return []; // no file yet is the normal first-run case
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt file must not break startup. Returning empty lets the user
      // re-add folders; pretending we restored them would be worse.
      return [];
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as LabosRootFile).version !== 1 ||
      !Array.isArray((parsed as LabosRootFile).roots)
    ) {
      return [];
    }

    return (parsed as LabosRootFile).roots.filter(
      (entry): entry is LabosPersistedRoot =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        typeof entry.label === 'string' &&
        typeof entry.absolutePath === 'string' &&
        path.isAbsolute(entry.absolutePath)
    );
  }

  async #write(roots: LabosPersistedRoot[]): Promise<void> {
    const filePath = this.#filePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload: LabosRootFile = { version: 1, roots };
    // Owner-only: this file names directories on the user's machine.
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
  }

  async add(root: LabosPersistedRoot): Promise<void> {
    const roots = await this.load();
    const without = roots.filter(existing => existing.id !== root.id);
    without.push({ ...root });
    await this.#write(without);
  }

  async remove(rootId: string): Promise<void> {
    const roots = await this.load();
    await this.#write(roots.filter(root => root.id !== rootId));
  }

  async markUnavailable(rootId: string): Promise<void> {
    const roots = await this.load();
    const next = roots.map(root =>
      root.id === rootId
        ? { ...root, unavailableAt: new Date().toISOString() }
        : root
    );
    await this.#write(next);
  }
}
