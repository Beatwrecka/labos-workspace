/**
 * LabOS Workspace — repository document contracts shared by main and renderer.
 *
 * These types are the boundary. The renderer never sees an absolute path: a
 * trusted root is referenced by an opaque id and a document by a
 * repository-relative path, so a renderer bug cannot name a file outside the
 * scope the user explicitly trusted.
 *
 * This file must stay dependency-free. It is imported by the main process, the
 * preload bundle and the renderer, so pulling in Electron or Node built-ins here
 * would break the renderer build.
 */

/** The six plain-English states a repository document can be in. */
export type LabosDocumentStatus =
  | 'saved-to-repo'
  | 'unsaved-draft'
  | 'updated-elsewhere'
  | 'conflict-review-needed'
  | 'file-moved-or-missing'
  | 'read-only';

/** Human-readable label for each state. Deliberately not "synced". */
export const LABOS_STATUS_LABELS: Record<LabosDocumentStatus, string> = {
  'saved-to-repo': 'Saved to repo',
  'unsaved-draft': 'Unsaved draft',
  'updated-elsewhere': 'Updated elsewhere',
  'conflict-review-needed': 'Conflict — review needed',
  'file-moved-or-missing': 'File moved/missing',
  'read-only': 'Read-only',
};

export interface LabosRootSummary {
  id: string;
  label: string;
  registeredAt: string;
}

export interface LabosDocumentSummary {
  relativePath: string;
  size: number;
  mtimeMs: number;
}

export interface LabosIndexResult {
  documents: LabosDocumentSummary[];
  /** True when the configured document cap stopped the scan early. */
  truncated: boolean;
  /** Directories visited, so a large root is visibly bounded rather than silent. */
  scannedDirectories: number;
  limits: {
    maxDocumentBytes: number;
    maxIndexedDocuments: number;
  };
}

export interface LabosDocumentRead {
  rootId: string;
  relativePath: string;
  content: string;
  /** sha256 of the exact bytes on disk. The save precondition. */
  hash: string;
  size: number;
  mtimeMs: number;
  readOnly: boolean;
}

export type LabosWriteFailureReason =
  | 'no-such-root'
  | 'outside-root'
  | 'not-a-regular-file'
  | 'read-only'
  | 'too-large'
  | 'hash-mismatch'
  | 'file-missing'
  | 'io-error';

export type LabosWriteResult =
  | { ok: true; hash: string; size: number; mtimeMs: number }
  | {
      ok: false;
      reason: LabosWriteFailureReason;
      message: string;
      /** Present on hash-mismatch so the caller can show a real compare. */
      actualHash?: string;
    };

export interface LabosFileChangeEvent {
  rootId: string;
  relativePath: string;
  kind: 'modified' | 'renamed-or-replaced' | 'deleted';
  hash: string | null;
  detectedAt: number;
}

/**
 * Operation-level failures. Distinct from a write result: a read that fails is
 * an error, whereas a write that is refused is an expected outcome with a reason.
 */
export interface LabosOperationError {
  message: string;
  code:
    | 'unknown-root'
    | 'not-found'
    | 'not-a-regular-file'
    | 'outside-root'
    | 'too-large'
    | 'io-error';
}

export interface LabosRegisterRootRequest {
  /** Opaque id chosen by the caller; stable across restarts. */
  id: string;
  label?: string;
}
