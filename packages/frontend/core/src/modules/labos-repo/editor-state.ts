/**
 * LabOS Workspace — repository document editor state.
 *
 * This models the thing the feature exists to get right: what the document's
 * true state is, and what the reader is told about it.
 *
 * The rule the briefing is explicit about: never label a failed or still-buffered
 * save "synced". So there is no such state here. A save that has not been
 * confirmed by the file service leaves the document in `unsaved-draft`, and a
 * save that was refused because the file moved underneath leaves it in
 * `conflict-review-needed`. "Saved to repo" is only ever returned after the
 * service has re-read the file and confirmed the hash.
 *
 * Kept free of React so it can be tested directly. The component is a thin
 * renderer over this.
 */

import type { LabosDocumentStatus,LabosWriteResult } from '../../../../apps/electron/src/shared/labos-repo';

export type {
  LabosDocumentStatus,
  LabosWriteResult,
} from '../../../../apps/electron/src/shared/labos-repo';


export interface LabosDocBaseline {
  /** Hash of the bytes the draft was based on. The save precondition. */
  hash: string;
  content: string;
  size: number;
  mtimeMs: number;
}

export interface LabosDocEditorState {
  status: LabosDocumentStatus;
  /** The draft in the editor. Equals the baseline content when clean. */
  draft: string;
  /** What is believed to be on disk right now. */
  baseline: LabosDocBaseline;
  /** Set when an external writer changed the file while a draft was dirty. */
  externalContent: string | null;
  /** Set when the file disappeared or was replaced by something unusable. */
  missingReason: string | null;
  /** Set when a save was refused for a reason the reader should see. */
  lastFailure: string | null;
  /** True between "save requested" and the service's answer. */
  saving: boolean;
  /**
   * True when the draft holds content whose on-disk hash is not yet confirmed.
   * A save must be blocked until a reload supplies the real hash, otherwise it
   * would be compared against a guess.
   */
  needsReload: boolean;
}

export function isDirty(state: LabosDocEditorState): boolean {
  return state.draft !== state.baseline.content;
}

export function createEditorState(
  read: { content: string; hash: string; size: number; mtimeMs: number; readOnly: boolean }
): LabosDocEditorState {
  return {
    status: read.readOnly ? 'read-only' : 'saved-to-repo',
    draft: read.content,
    baseline: {
      hash: read.hash,
      content: read.content,
      size: read.size,
      mtimeMs: read.mtimeMs,
    },
    externalContent: null,
    missingReason: null,
    lastFailure: null,
    saving: false,
    needsReload: false,
  };
}

/** Record an edit. Never changes `baseline`; only the draft. */
export function applyEdit(
  state: LabosDocEditorState,
  nextDraft: string
): LabosDocEditorState {
  if (state.status === 'read-only') {
    // A read-only document must not become dirty, or the UI would offer a save
    // that cannot succeed.
    return state;
  }
  const base: LabosDocEditorState = { ...state, draft: nextDraft, lastFailure: null };
  if (nextDraft === state.baseline.content) {
    // Back to the on-disk content: no draft, and a prior conflict is resolved
    // only if the external version was also accepted.
    return {
      ...base,
      status:
        state.externalContent === null ? 'saved-to-repo' : state.status,
    };
  }
  if (state.status === 'conflict-review-needed') {
    return base; // stays in conflict until the reader chooses
  }
  return { ...base, status: 'unsaved-draft' };
}

/** Mark that a save has been requested and is awaiting the service's answer. */
export function beginSave(state: LabosDocEditorState): LabosDocEditorState {
  return { ...state, saving: true, lastFailure: null };
}

/**
 * Apply the service's answer.
 *
 * A refusal is never treated as success, and the resulting status is chosen from
 * the reason rather than from optimism.
 */
export function applySaveResult(
  state: LabosDocEditorState,
  result: LabosWriteResult
): LabosDocEditorState {
  if (result.ok) {
    return {
      ...state,
      saving: false,
      status: 'saved-to-repo',
      baseline: {
        hash: result.hash,
        content: state.draft,
        size: result.size,
        mtimeMs: result.mtimeMs,
      },
      externalContent: null,
      lastFailure: null,
      missingReason: null,
    };
  }

  const failure = describeWriteFailure(result.reason);

  // A stale save is a conflict, not a generic error: both versions still exist
  // and the reader has to choose. `actualHash` is not applied to the baseline,
  // because doing so would silently adopt the external content as "ours".
  if (result.reason === 'hash-mismatch') {
    return {
      ...state,
      saving: false,
      status: 'conflict-review-needed',
      lastFailure: failure,
    };
  }

  if (result.reason === 'file-missing') {
    return {
      ...state,
      saving: false,
      status: 'file-moved-or-missing',
      missingReason: failure,
      lastFailure: failure,
    };
  }

  if (result.reason === 'read-only') {
    return {
      ...state,
      saving: false,
      status: 'read-only',
      lastFailure: failure,
    };
  }

  return {
    ...state,
    saving: false,
    // Everything else leaves the draft unsaved. Claiming otherwise is the one
    // thing this must never do.
    status: isDirty(state) ? 'unsaved-draft' : state.status,
    lastFailure: failure,
  };
}

/**
 * Record that an external writer changed the file.
 *
 * A clean view can adopt the new content outright. A dirty view must NOT: the
 * draft is kept and the state becomes a conflict, so neither version is lost.
 */
export function applyExternalChange(
  state: LabosDocEditorState,
  change: { newContent: string; newHash: string; newSize: number; newMtimeMs: number }
): LabosDocEditorState {
  if (isDirty(state)) {
    return {
      ...state,
      status: 'conflict-review-needed',
      externalContent: change.newContent,
      // The baseline still points at the version the draft was built from. It is
      // deliberately NOT advanced to the external hash: doing so would make the
      // stale draft look current and let it overwrite the external edit.
      lastFailure:
        'This file changed on disk while you were editing. Choose which version to keep.',
    };
  }

  return {
    ...state,
    status: state.status === 'read-only' ? 'read-only' : 'saved-to-repo',
    draft: change.newContent,
    baseline: {
      hash: change.newHash,
      content: change.newContent,
      size: change.newSize,
      mtimeMs: change.newMtimeMs,
    },
    externalContent: null,
    lastFailure: null,
  };
}

/**
 * Apply the reader's conflict decision.
 *
 * "Take theirs" adopts the external content but deliberately marks the baseline
 * hash as unknown. The caller must reload to get the real hash before any save,
 * because a draft saved against a guessed hash could overwrite content the app
 * never actually read.
 *
 * "Keep mine" keeps the draft and the ORIGINAL baseline hash, so the subsequent
 * save is compared against what was actually read; the service will refuse it if
 * the file changed again in the meantime.
 */
export function resolveConflict(
  state: LabosDocEditorState,
  choice: 'keep-mine' | 'take-theirs'
): LabosDocEditorState {
  if (state.externalContent === null) return state;

  if (choice === 'take-theirs') {
    return {
      ...state,
      // Not 'saved-to-repo': nothing has verified that these bytes are on disk
      // with this content. A reload supplies the confirmed hash and status.
      status: 'updated-elsewhere',
      draft: state.externalContent,
      externalContent: null,
      lastFailure: null,
      needsReload: true,
    };
  }

  return {
    ...state,
    status: 'unsaved-draft',
    externalContent: null,
    lastFailure: null,
  };
}

/** Record that the file vanished or became unusable. */
export function applyMissing(
  state: LabosDocEditorState,
  reason: string
): LabosDocEditorState {
  return {
    ...state,
    status: 'file-moved-or-missing',
    missingReason: reason,
    lastFailure: reason,
  };
}

/** Plain-English description of a refused write. */
export function describeWriteFailure(
  reason:
    | 'no-such-root'
    | 'outside-root'
    | 'not-a-regular-file'
    | 'read-only'
    | 'too-large'
    | 'hash-mismatch'
    | 'file-missing'
    | 'io-error'
): string {
  switch (reason) {
    case 'no-such-root':
      return 'This repository folder is no longer registered.';
    case 'outside-root':
      return 'That path is outside the folder you added, so it was not opened.';
    case 'not-a-regular-file':
      return 'That path is not an ordinary file, so it was not opened.';
    case 'read-only':
      return 'The file is read-only on disk, so the change was not saved.';
    case 'too-large':
      return 'The document is larger than the editable size limit.';
    case 'hash-mismatch':
      return 'The file changed on disk since it was opened. Nothing was overwritten.';
    case 'file-missing':
      return 'The file no longer exists at that path.';
    case 'io-error':
      return 'The save failed. The previous version is still on disk.';
  }
}

/**
 * Whether a save may be attempted.
 *
 * A save is deliberately blocked while a conflict is unresolved: offering a save
 * there would either overwrite the external version or silently discard the
 * draft, and both are the failure this feature exists to prevent.
 */
export function canSave(state: LabosDocEditorState): boolean {
  if (state.saving) return false;
  if (state.needsReload) return false;
  if (state.status === 'read-only') return false;
  if (state.status === 'file-moved-or-missing') return false;
  if (state.status === 'conflict-review-needed') return false;
  return isDirty(state);
}
