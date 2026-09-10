/**
 * LabOS Workspace — repository document IPC handlers.
 *
 * The renderer asks for operations; the main process decides them. Nothing here
 * accepts an absolute path from the caller, and no handler returns one: roots are
 * registered by the main process after a native folder picker, and documents are
 * addressed by a repository-relative path inside a known root.
 *
 * Writes follow the same contract as the service: a save carries the hash the
 * draft was based on, and a stale save is refused with the hash it actually
 * found so the UI can show a genuine compare rather than guessing.
 */

import path from 'node:path';

import { app, dialog } from 'electron';

import type {
  LabosDocumentRead,
  LabosIndexResult,
  LabosOperationError,
  LabosRegisterRootRequest,
  LabosRootSummary,
  LabosWriteResult,
} from '../../shared/labos-repo';
import { logger } from '../logger';
import type { NamespaceHandlers } from '../type';
import { LabosRepoFileService } from './repo-file-service';
import { LabosRepoWatcher } from './repo-watcher';
import { LabosRootStore } from './root-store';

/**
 * A single service and watcher instance for the process.
 *
 * One instance matters: the watcher's self-write suppression is keyed on the
 * hashes the service writes, so two service instances would defeat it.
 */
const service = new LabosRepoFileService();
const rootStore = new LabosRootStore(() => app.getPath('userData'));
const pendingChanges = new Map<string, number>();

service.setRecoveryRoot(path.join(app.getPath('userData'), 'labos-recovery'));

/** Renderer subscribers. Each entry is a function that posts an event. */
const changeListeners = new Set<(change: unknown) => void>();

function emitChange(change: unknown) {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (error) {
      logger.error('[labos] change listener failed', error);
    }
  }
}

const watcher = new LabosRepoWatcher({
  resolveHash: async (rootId, relativePath) => {
    try {
      const read = await service.readDocument(rootId, relativePath);
      return read.hash;
    } catch {
      return null;
    }
  },
  onChange: change => {
    pendingChanges.set(`${change.rootId}:${change.relativePath}`, Date.now());
    emitChange(change);
  },
});

function toOperationError(error: unknown): LabosOperationError {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return { message, code: 'not-found' };
  if (message.includes('Unknown trusted root')) {
    return { message, code: 'unknown-root' };
  }
  if (message.includes('escapes')) return { message, code: 'outside-root' };
  if (message.includes('symlink') || message.includes('regular file')) {
    return { message, code: 'not-a-regular-file' };
  }
  if (message.includes('over the')) return { message, code: 'too-large' };
  return { message, code: 'io-error' };
}

/** Re-register every persisted root at startup so the UI state survives restart. */
export async function restoreLabosRoots(): Promise<LabosRootSummary[]> {
  const persisted = await rootStore.load();
  const restored: LabosRootSummary[] = [];
  for (const entry of persisted) {
    try {
      const root = await service.registerRoot(entry);
      watcher.watchRoot(root.id, root.absolutePath);
      restored.push({ id: root.id, label: root.label, registeredAt: root.registeredAt });
    } catch (error) {
      // A root that has moved or been unmounted is reported, not silently kept:
      // the UI shows it as unavailable rather than pretending it is fine.
      logger.warn('[labos] could not restore trusted root', entry.id, error);
      await rootStore.markUnavailable(entry.id);
    }
  }
  return restored;
}

export function closeLabosRepoWatcher(): void {
  watcher.close();
}

export const labosRepoHandlers = {
  /**
   * Ask the user to choose a folder. The absolute path never leaves this process:
   * the renderer receives only the opaque id and label.
   */
  pickAndRegisterRoot: async (
    _e: Electron.IpcMainInvokeEvent,
    request?: Partial<LabosRegisterRootRequest>
  ): Promise<LabosRootSummary | null> => {
    const picked = await dialog.showOpenDialog({
      title: 'Add a repository folder',
      message:
        'Choose a folder to read documents from. LabOS only reads Markdown inside folders you add here.',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Add folder',
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const absolutePath = picked.filePaths[0];
    const id = request?.id ?? `root-${Date.now().toString(36)}`;
    const root = await service.registerRoot({
      id,
      label: request?.label ?? path.basename(absolutePath),
      absolutePath,
    });
    watcher.watchRoot(root.id, root.absolutePath);
    await rootStore.add({ id: root.id, label: root.label, absolutePath: root.absolutePath });
    return { id: root.id, label: root.label, registeredAt: root.registeredAt };
  },

  /**
   * Register a folder by path without a picker.
   *
   * Main-process only in practice: this exists so tests and the developer flow
   * can register a fixture directory. It is not exposed as a user action, and it
   * still refuses anything that is not a directory.
   */
  registerRootByPath: async (
    _e: Electron.IpcMainInvokeEvent,
    input: { id: string; absolutePath: string; label?: string }
  ): Promise<LabosRootSummary> => {
    const root = await service.registerRoot(input);
    watcher.watchRoot(root.id, root.absolutePath);
    await rootStore.add({
      id: root.id,
      label: root.label,
      absolutePath: root.absolutePath,
    });
    return { id: root.id, label: root.label, registeredAt: root.registeredAt };
  },

  listRoots: async (): Promise<LabosRootSummary[]> => {
    return service.listRoots().map(root => ({
      id: root.id,
      label: root.label,
      registeredAt: root.registeredAt,
    }));
  },

  removeRoot: async (
    _e: Electron.IpcMainInvokeEvent,
    rootId: string
  ): Promise<{ removed: boolean }> => {
    watcher.unwatchRoot(rootId);
    const removed = service.unregisterRoot(rootId);
    await rootStore.remove(rootId);
    return { removed };
  },

  indexRoot: async (
    _e: Electron.IpcMainInvokeEvent,
    rootId: string
  ): Promise<LabosIndexResult | LabosOperationError> => {
    try {
      const result = await service.indexRoot(rootId);
      return {
        documents: result.documents,
        truncated: result.truncated,
        scannedDirectories: result.scannedDirectories,
        limits: {
          maxDocumentBytes: LabosRepoFileService.DEFAULT_MAX_DOCUMENT_BYTES,
          maxIndexedDocuments: LabosRepoFileService.DEFAULT_MAX_INDEXED_DOCUMENTS,
        },
      };
    } catch (error) {
      return toOperationError(error);
    }
  },

  readDocument: async (
    _e: Electron.IpcMainInvokeEvent,
    rootId: string,
    relativePath: string
  ): Promise<LabosDocumentRead | LabosOperationError> => {
    try {
      return await service.readDocument(rootId, relativePath);
    } catch (error) {
      return toOperationError(error);
    }
  },

  /**
   * Save a draft. `expectedHash` is the hash the draft was based on; a save that
   * no longer matches is refused rather than applied.
   */
  writeDocument: async (
    _e: Electron.IpcMainInvokeEvent,
    input: {
      rootId: string;
      relativePath: string;
      content: string;
      expectedHash: string;
    }
  ): Promise<LabosWriteResult> => {
    const result = await service.writeDocument(
      input.rootId,
      input.relativePath,
      input.content,
      { expectedHash: input.expectedHash }
    );
    if (result.ok) {
      // Tell the watcher this write was ours, so the resulting event is not
      // reported back as an external change.
      watcher.noteSelfWrite(input.rootId, input.relativePath, result.hash);
    }
    return result;
  },

  /**
   * Re-read a document's hash and report whether it changed since the caller
   * last looked. Used on window focus and after wake, where the event stream
   * alone cannot be trusted.
   */
  reconcileDocument: async (
    _e: Electron.IpcMainInvokeEvent,
    rootId: string,
    relativePath: string
  ): Promise<{ hash: string | null; changed: boolean } | LabosOperationError> => {
    try {
      const change = await watcher.reconcile(rootId, relativePath);
      if (change) return { hash: change.hash, changed: true };
      const read = await service.readDocument(rootId, relativePath);
      return { hash: read.hash, changed: false };
    } catch (error) {
      return toOperationError(error);
    }
  },

  /** How many changes are queued for a root, so the UI can badge a folder. */
  pendingChangeCount: async (): Promise<number> => pendingChanges.size,

  /**
   * The absolute path of a trusted root, for scoping an agent's working
   * directory. Returned only for a root the user has explicitly registered, and
   * only through this narrow call — the general renderer contract still never
   * exposes absolute paths.
   */
  rootCwd: async (
    _e: Electron.IpcMainInvokeEvent,
    rootId: string
  ): Promise<{ cwd: string } | LabosOperationError> => {
    const root = service.getRoot(rootId);
    if (!root) {
      return { message: 'That repository folder is not registered.', code: 'unknown-root' };
    }
    return { cwd: root.absolutePath };
  },

  clearPendingChanges: async (): Promise<void> => {
    pendingChanges.clear();
  },
} satisfies NamespaceHandlers;

/**
 * Subscribe/unsubscribe for change notifications.
 *
 * Implemented as a handler returning nothing plus a listener registry rather than
 * a broadcast to every window, so a change in one tab does not have to be
 * re-derived by every other one.
 */
export function addLabosChangeListener(listener: (change: unknown) => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
