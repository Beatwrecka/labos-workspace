/**
 * LabOS Workspace — repository document view.
 *
 * The presentation half of the feature. All safety-critical decisions already
 * happened in `editor-state.ts` and `markdown.ts`; this file renders their output
 * and offers only the actions the current state actually permits.
 *
 * The two rules it must not break:
 *  - never present an unsaved or failed save as saved, and
 *  - never let one version of a file overwrite the other without the reader
 *    choosing, so Save is unavailable while a conflict is unresolved.
 */

import { Button } from '@affine/component';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LabosDocumentStatus,
  LabosWriteResult,
} from '../../../../apps/electron/src/shared/labos-repo';
import { LABOS_STATUS_LABELS } from '../../../../apps/electron/src/shared/labos-repo';
import {
  applyEdit,
  applyExternalChange,
  applyMissing,
  applySaveResult,
  beginSave,
  canSave,
  createEditorState,
  type LabosDocEditorState,
  resolveConflict,
} from './editor-state';
import { renderMarkdown } from './markdown';
import { RenderedDocument } from './rendered-document';
import {
  actions,
  body,
  breadcrumb,
  breadcrumbPath,
  breadcrumbRoot,
  breadcrumbSeparator,
  conflictActions,
  conflictBody,
  conflictColumn,
  conflictColumnLabel,
  conflictHeader,
  conflictPanel,
  conflictPre,
  editor as editorStyle,
  emptyState,
  emptyTitle,
  fileBadge,
  fileList,
  fileListButton,
  main,
  notice,
  page,
  statusBar,
  statusChip,
  toc as tocStyle,
  tocItem,
  tocItemLevel,
  tocTitle,
  toolbar,
} from './styles.css';

export interface LabosRepoDocumentViewProps {
  rootLabel: string;
  relativePath: string;
  /** Read the document from the main process. */
  readDocument: () => Promise<
    | { content: string; hash: string; size: number; mtimeMs: number; readOnly: boolean }
    | { error: string }
  >;
  /** Save a draft, returning the service's decision. */
  writeDocument: (input: {
    content: string;
    expectedHash: string;
  }) => Promise<LabosWriteResult>;
  /** Re-read after a conflict or a missing file. */
  onReload: () => void;
  /** Open the file in the user's editor, if available. */
  onOpenExternally?: () => void;
}

/** Accessible name for the status, so colour is never the only signal. */
function statusDescription(
  status: LabosDocumentStatus,
  state: LabosDocEditorState
): string {
  switch (status) {
    case 'saved-to-repo':
      return 'The file on disk matches what you see.';
    case 'unsaved-draft':
      return 'You have changes that have not been written to the file yet.';
    case 'updated-elsewhere':
      return 'The file changed elsewhere. Reload to continue editing safely.';
    case 'conflict-review-needed':
      return 'Both your draft and an external change exist. Choose which to keep.';
    case 'file-moved-or-missing':
      return (
        state.missingReason ??
        'The file is no longer at this path. Your draft has been kept.'
      );
    case 'read-only':
      return 'The file is read-only on disk, so it cannot be edited here.';
  }
}

export function LabosRepoDocumentView({
  rootLabel,
  relativePath,
  readDocument,
  writeDocument,
  onReload,
  onOpenExternally,
}: LabosRepoDocumentViewProps) {
  const [state, setState] = useState<LabosDocEditorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'read' | 'source'>('read');
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const result = await readDocument();
    if ('error' in result) {
      setLoadError(result.error);
      setState(null);
      return;
    }
    setLoadError(null);
    setState(createEditorState(result));
  }, [readDocument]);

  useEffect(() => {
    // A failed load is already reported through loadError; nothing further to do
    // with the rejection here.
    load().catch(() => {});
  }, [load]);

  const rendered = useMemo(
    () => (state ? renderMarkdown(state.draft) : null),
    [state]
  );

  const handleSave = useCallback(async () => {
    if (!state || !canSave(state)) return;
    // Mark the save in flight first: until the service answers, the document is
    // not saved, and the UI must say so.
    const inFlight = beginSave(state);
    setState(inFlight);

    const result = await writeDocument({
      content: inFlight.draft,
      expectedHash: inFlight.baseline.hash,
    });
    setState(current => (current ? applySaveResult(current, result) : current));
  }, [state, writeDocument]);

  const handleDraftChange = useCallback((next: string) => {
    setState(current => (current ? applyEdit(current, next) : current));
  }, []);

  // Warn before losing a dirty draft to a window close.
  useEffect(() => {
    if (!state || !canSave(state)) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  // Keyboard: Cmd/Ctrl+S saves, and Escape returns from source to reading view.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        // handleSave reports its own failures through state; the rejection path
        // is already handled, so this only needs to not float.
        handleSave().catch(() => {});
      }
      if (event.key === 'Escape' && mode === 'source') {
        setMode('read');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, mode]);

  if (loadError) {
    return (
      <div className={page}>
        <div className={emptyState}>
          <span className={emptyTitle}>This file could not be opened</span>
          <span>{loadError}</span>
          <Button onClick={onReload}>Try again</Button>
        </div>
      </div>
    );
  }

  if (!state || !rendered) {
    return (
      <div className={page}>
        <div className={emptyState}>
          <span>Opening {relativePath}…</span>
        </div>
      </div>
    );
  }

  const saveable = canSave(state);

  return (
    <div className={page}>
      <header className={toolbar}>
        <span className={fileBadge} title="This document is a file in your repository">
          <span aria-hidden="true">▪</span>
          File-backed
        </span>
        <nav className={breadcrumb} aria-label="Document location">
          <span className={breadcrumbRoot}>{rootLabel}</span>
          <span className={breadcrumbSeparator} aria-hidden="true">
            /
          </span>
          <span className={breadcrumbPath}>{relativePath}</span>
        </nav>
        <div className={actions}>
          {onOpenExternally ? (
            <Button onClick={onOpenExternally} variant="plain">
              Open in editor
            </Button>
          ) : null}
          <Button
            onClick={() => setMode(mode === 'read' ? 'source' : 'read')}
            variant="plain"
            aria-pressed={mode === 'source'}
          >
            {mode === 'read' ? 'Edit source' : 'Done editing'}
          </Button>
          <Button
            onClick={() => {
              handleSave().catch(() => {});
            }}
            disabled={!saveable}
          >
            {state.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <div className={body}>
        {mode === 'read' && rendered.toc.length > 0 ? (
          <nav className={tocStyle} aria-label="Table of contents">
            <div className={tocTitle}>Contents</div>
            {rendered.toc.map(entry => (
              <button
                key={entry.id}
                type="button"
                className={`${tocItem} ${tocItemLevel[entry.level as 1 | 2 | 3 | 4 | 5 | 6]}`}
                onClick={() => {
                  const target = document.getElementById(entry.id);
                  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {entry.text}
              </button>
            ))}
          </nav>
        ) : null}

        {mode === 'read' ? (
          <div className={main}>
            {state.status === 'conflict-review-needed' && state.externalContent !== null ? (
              <section className={conflictPanel} aria-label="Conflict">
                <div className={conflictHeader}>
                  Conflict — review needed. Nothing has been overwritten.
                </div>
                <div className={conflictBody}>
                  <div className={conflictColumn}>
                    <div className={conflictColumnLabel}>Your draft</div>
                    <pre className={conflictPre}>{state.draft}</pre>
                  </div>
                  <div className={conflictColumn}>
                    <div className={conflictColumnLabel}>On disk now</div>
                    <pre className={conflictPre}>{state.externalContent}</pre>
                  </div>
                </div>
                <div className={conflictActions}>
                  <Button
                    onClick={() =>
                      setState(current =>
                        current ? resolveConflict(current, 'keep-mine') : current
                      )
                    }
                  >
                    Keep my draft
                  </Button>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setState(current =>
                        current ? resolveConflict(current, 'take-theirs') : current
                      );
                      // Reload so we hold a confirmed hash for the external
                      // content rather than a guess.
                      onReload();
                    }}
                  >
                    Use the version on disk
                  </Button>
                  <Button variant="plain" onClick={onReload}>
                    Reload from disk
                  </Button>
                </div>
              </section>
            ) : null}

            {state.status === 'updated-elsewhere' ? (
              <p className={notice} role="status">
                This file changed on disk. Reload to continue editing safely.
              </p>
            ) : null}

            <RenderedDocument document={rendered} />
          </div>
        ) : (
          <textarea
            ref={editorRef}
            className={editorStyle}
            value={state.draft}
            readOnly={state.status === 'read-only'}
            spellCheck={false}
            aria-label={`Source of ${relativePath}`}
            onChange={event => handleDraftChange(event.target.value)}
          />
        )}
      </div>

      <footer className={statusBar}>
        <span
          className={statusChip[state.status]}
          role="status"
          aria-live="polite"
          title={statusDescription(state.status, state)}
        >
          {LABOS_STATUS_LABELS[state.status]}
        </span>
        {state.lastFailure ? <span>{state.lastFailure}</span> : null}
        {state.missingReason && !state.lastFailure ? (
          <span>{state.missingReason}</span>
        ) : null}
      </footer>
    </div>
  );
}

/**
 * Empty state listing the Markdown files found in a folder.
 *
 * Shown instead of a fabricated document list: if a folder has no Markdown, the
 * honest answer is that it has none.
 */
export function LabosRepoFileList({
  documents,
  truncated,
  onOpen,
}: {
  documents: { relativePath: string; size: number }[];
  truncated: boolean;
  onOpen: (relativePath: string) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className={emptyState}>
        <span className={emptyTitle}>No Markdown files in this folder</span>
        <span>
          LabOS reads <code>.md</code> files. Generated folders, dependencies and
          secret files are skipped.
        </span>
      </div>
    );
  }

  return (
    <div className={emptyState}>
      <span className={emptyTitle}>Choose a document</span>
      <div className={fileList}>
        {documents.map(document => (
          <button
            key={document.relativePath}
            type="button"
            className={fileListButton}
            onClick={() => onOpen(document.relativePath)}
          >
            {document.relativePath}
          </button>
        ))}
      </div>
      {truncated ? (
        <span>
          Showing the first {documents.length} documents; this folder has more.
        </span>
      ) : null}
    </div>
  );
}

/** Apply an external change reported by the watcher to the editor state. */
export { applyExternalChange, applyMissing };
