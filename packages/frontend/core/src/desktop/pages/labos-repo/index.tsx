/**
 * LabOS Workspace — /labos/repo page.
 *
 * Connects the repository document view to the live IPC handlers. This is the
 * only place the renderer touches the LabOS API, so the components below it stay
 * testable without a running Electron main process.
 *
 * Everything degrades honestly: if the desktop API is unavailable (running in a
 * browser during development, or on a platform where the handlers are absent)
 * the page says so rather than showing an empty or fabricated document list.
 */

import { Button } from '@affine/component';
import { DesktopApiService } from '@affine/core/modules/desktop-api';
import {
  LabosRepoDocumentView,
  LabosRepoFileList,
} from '@affine/core/modules/labos-repo/document-view';
import {
  emptyState,
  fileList,
  fileListButton,
  page,
} from '@affine/core/modules/labos-repo/styles.css';
import { useServiceOptional } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import type {
  LabosDocumentRead,
  LabosIndexResult,
  LabosOperationError,
  LabosRootSummary,
  LabosWriteResult,
} from '../../../../../apps/electron/src/shared/labos-repo';

interface LabosRepoHandler {
  listRoots: () => Promise<LabosRootSummary[]>;
  pickAndRegisterRoot: (request?: {
    id?: string;
    label?: string;
  }) => Promise<LabosRootSummary | null>;
  indexRoot: (rootId: string) => Promise<LabosIndexResult | LabosOperationError>;
  readDocument: (
    rootId: string,
    relativePath: string
  ) => Promise<LabosDocumentRead | LabosOperationError>;
  writeDocument: (input: {
    rootId: string;
    relativePath: string;
    content: string;
    expectedHash: string;
  }) => Promise<LabosWriteResult>;
}

function isOperationError(
  value: LabosDocumentRead | LabosIndexResult | LabosOperationError
): value is LabosOperationError {
  return typeof (value as LabosOperationError).code === 'string';
}

export const Component = () => {
  const desktopApi = useServiceOptional(DesktopApiService);
  const labos = (desktopApi?.handler as { labosRepo?: LabosRepoHandler } | undefined)
    ?.labosRepo;

  const [roots, setRoots] = useState<LabosRootSummary[]>([]);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<LabosIndexResult | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshRoots = useCallback(async () => {
    if (!labos) return;
    try {
      const list = await labos.listRoots();
      setRoots(list);
      setActiveRootId(current => current ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [labos]);

  useEffect(() => {
    refreshRoots().catch(() => {});
  }, [refreshRoots]);

  const refreshDocuments = useCallback(
    async (rootId: string) => {
      if (!labos) return;
      const result = await labos.indexRoot(rootId);
      if (isOperationError(result)) {
        setError(result.message);
        setDocuments(null);
        return;
      }
      setError(null);
      setDocuments(result);
    },
    [labos]
  );

  useEffect(() => {
    if (!activeRootId) return;
    refreshDocuments(activeRootId).catch(() => {});
  }, [activeRootId, refreshDocuments]);

  const handleAddFolder = useCallback(async () => {
    if (!labos) return;
    const root = await labos.pickAndRegisterRoot();
    if (!root) return; // the picker was cancelled
    await refreshRoots();
    setActiveRootId(root.id);
  }, [labos, refreshRoots]);

  // The desktop API is absent when this page is opened outside the Electron app.
  if (!labos) {
    return (
      <div className={page}>
        <div className={emptyState}>
          <span>Repository documents need the desktop app</span>
          <span>
            LabOS reads files through a local service that is only available in the
            installed app, not in a browser.
          </span>
        </div>
      </div>
    );
  }

  if (activePath && activeRootId) {
    const rootLabel =
      roots.find(root => root.id === activeRootId)?.label ?? activeRootId;
    const rootId = activeRootId;
    const path = activePath;

    return (
      <LabosRepoDocumentView
        rootLabel={rootLabel}
        relativePath={path}
        readDocument={async () => {
          const result = await labos.readDocument(rootId, path);
          if (isOperationError(result)) {
            return { error: result.message };
          }
          return {
            content: result.content,
            hash: result.hash,
            size: result.size,
            mtimeMs: result.mtimeMs,
            readOnly: result.readOnly,
          };
        }}
        writeDocument={(input: { content: string; expectedHash: string }) =>
          labos.writeDocument({
            rootId,
            relativePath: path,
            content: input.content,
            expectedHash: input.expectedHash,
          })
        }
        // Returning to the list forces a fresh read the next time the document is
        // opened, which is what makes "Reload from disk" meaningful.
        onReload={() => {
          void refreshDocuments(rootId).catch(() => {});
          setActivePath(null);
        }}
      />
    );
  }

  return (
    <div className={page}>
      <div className={emptyState}>
        <span>Repository documents</span>
        {error ? <span>{error}</span> : null}

        {roots.length === 0 ? (
          <>
            <span>
              Add a folder to read its Markdown. Nothing is scanned until you choose
              it, and secret files, dependencies and generated folders are skipped.
            </span>
            <Button onClick={() => {
                handleAddFolder().catch(() => {});
              }}>
              Add a repository folder
            </Button>
          </>
        ) : (
          <>
            <span>Folders you have added</span>
            <div className={fileList}>
              {roots.map(root => (
                <button
                  key={root.id}
                  type="button"
                  className={fileListButton}
                  aria-pressed={root.id === activeRootId}
                  onClick={() => {
                    setActiveRootId(root.id);
                    setActivePath(null);
                  }}
                >
                  {root.label}
                  {root.id === activeRootId ? ' — selected' : ''}
                </button>
              ))}
            </div>
            <Button onClick={() => {
                handleAddFolder().catch(() => {});
              }}>
              Add another folder
            </Button>
            {documents ? (
              <LabosRepoFileList
                documents={documents.documents}
                truncated={documents.truncated}
                onOpen={setActivePath}
              />
            ) : (
              <span>Reading this folder…</span>
            )}
          </>
        )}
      </div>
    </div>
  );
};
