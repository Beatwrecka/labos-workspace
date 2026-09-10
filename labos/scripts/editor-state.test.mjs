/**
 * LabOS Workspace — repository document editor state tests.
 *
 * Run with: node --test labos/scripts/editor-state.test.mjs
 *
 * The QA checklist is explicit that a failed or still-buffered save must never
 * be labelled "synced", that a dirty draft must never be silently overwritten,
 * and that a stale save must fail safely. Those are properties of this state
 * machine, so they are asserted directly here rather than inferred from the UI.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);

async function loadModule(relativeSourcePath) {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(repoRoot, relativeSourcePath);
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      // The module imports a type from the electron app; type-only imports are
      // erased by transpilation, so nothing needs to resolve at runtime.
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}

const editor = await loadModule(
  'packages/frontend/core/src/modules/labos-repo/editor-state.ts'
);

const readFixture = (overrides = {}) => ({
  content: 'original content',
  hash: 'hash-1',
  size: 16,
  mtimeMs: 1000,
  readOnly: false,
  ...overrides,
});

const clean = () => editor.createEditorState(readFixture());

// --- the honest-status guarantee ---------------------------------------------

test('a freshly read document is saved, not "synced"', () => {
  const state = clean();
  assert.equal(state.status, 'saved-to-repo');
  // There is deliberately no synced state at all.
  assert.ok(!Object.keys(editor).includes('markSynced'));
});

test('a save in flight is not reported as saved', () => {
  const state = editor.beginSave(editor.applyEdit(clean(), 'edited'));
  assert.equal(state.saving, true);
  assert.equal(
    state.status,
    'unsaved-draft',
    'a buffered save must not be presented as complete'
  );
});

test('a generic write failure leaves the draft unsaved and explains why', () => {
  let state = editor.beginSave(editor.applyEdit(clean(), 'edited'));
  state = editor.applySaveResult(state, {
    ok: false,
    reason: 'io-error',
    message: 'disk full',
  });

  assert.equal(state.status, 'unsaved-draft', 'never reported as saved');
  assert.equal(state.saving, false);
  assert.match(state.lastFailure, /failed/i);
  assert.equal(
    editor.isDirty(state),
    true,
    'the draft is retained so nothing is lost'
  );
});

test('a read-only write refusal is reported as read-only, not as an error', () => {
  let state = editor.beginSave(editor.applyEdit(clean(), 'edited'));
  state = editor.applySaveResult(state, {
    ok: false,
    reason: 'read-only',
    message: 'not writable',
  });
  assert.equal(state.status, 'read-only');
});

// --- successful saves ---------------------------------------------------------

test('a confirmed save adopts the new hash as the baseline', () => {
  let state = editor.beginSave(editor.applyEdit(clean(), 'edited'));
  state = editor.applySaveResult(state, {
    ok: true,
    hash: 'hash-2',
    size: 6,
    mtimeMs: 2000,
  });

  assert.equal(state.status, 'saved-to-repo');
  assert.equal(state.baseline.hash, 'hash-2');
  assert.equal(state.baseline.content, 'edited');
  assert.equal(editor.isDirty(state), false);
  assert.equal(editor.canSave(state), false, 'nothing left to save');
});

// --- conflict: the critical path ---------------------------------------------

test('a stale save becomes a conflict and does not adopt the external hash', () => {
  const edited = editor.applyEdit(clean(), 'my draft');
  let state = editor.beginSave(edited);
  state = editor.applySaveResult(state, {
    ok: false,
    reason: 'hash-mismatch',
    message: 'changed on disk',
    actualHash: 'hash-external',
  });

  assert.equal(state.status, 'conflict-review-needed');
  assert.equal(editor.isDirty(state), true, 'the draft survives');
  assert.equal(
    state.baseline.hash,
    'hash-1',
    'the baseline must NOT advance to the external hash, or the stale draft ' +
      'would look current and overwrite the external edit'
  );
  assert.equal(
    editor.canSave(state),
    false,
    'a save must be blocked while a conflict is unresolved'
  );
});

test('an external change to a CLEAN document is adopted outright', () => {
  const state = editor.applyExternalChange(clean(), {
    newContent: 'external version',
    newHash: 'hash-external',
    newSize: 16,
    newMtimeMs: 3000,
  });

  assert.equal(state.status, 'saved-to-repo');
  assert.equal(state.draft, 'external version');
  assert.equal(state.baseline.hash, 'hash-external');
  assert.equal(editor.isDirty(state), false);
});

test('an external change to a DIRTY document keeps both versions', () => {
  const dirty = editor.applyEdit(clean(), 'my unsaved work');
  const state = editor.applyExternalChange(dirty, {
    newContent: 'external version',
    newHash: 'hash-external',
    newSize: 16,
    newMtimeMs: 3000,
  });

  assert.equal(state.status, 'conflict-review-needed');
  assert.equal(state.draft, 'my unsaved work', 'the draft is preserved');
  assert.equal(
    state.externalContent,
    'external version',
    'the external version is preserved too'
  );
  assert.equal(
    state.baseline.hash,
    'hash-1',
    'the baseline still points at the version the draft was based on'
  );
  assert.ok(state.lastFailure, 'the reader is told what happened');
});

test('resolving a conflict with "keep mine" keeps the original baseline hash', () => {
  const dirty = editor.applyEdit(clean(), 'my unsaved work');
  const conflicted = editor.applyExternalChange(dirty, {
    newContent: 'external version',
    newHash: 'hash-external',
    newSize: 16,
    newMtimeMs: 3000,
  });

  const resolved = editor.resolveConflict(conflicted, 'keep-mine');
  assert.equal(resolved.status, 'unsaved-draft');
  assert.equal(resolved.draft, 'my unsaved work');
  assert.equal(
    resolved.baseline.hash,
    'hash-1',
    'the next save must be compared against what was actually read'
  );
  assert.equal(
    editor.canSave(resolved),
    true,
    'the reader can now attempt the save, which may itself be refused again'
  );
});

test('resolving a conflict with "take theirs" requires a reload before saving', () => {
  const dirty = editor.applyEdit(clean(), 'my unsaved work');
  const conflicted = editor.applyExternalChange(dirty, {
    newContent: 'external version',
    newHash: 'hash-external',
    newSize: 16,
    newMtimeMs: 3000,
  });

  const resolved = editor.resolveConflict(conflicted, 'take-theirs');
  assert.equal(
    resolved.status,
    'updated-elsewhere',
    'these bytes are not confirmed on disk, so this is not "saved"'
  );
  assert.equal(resolved.draft, 'external version');
  assert.equal(resolved.needsReload, true);
  assert.equal(
    editor.canSave(resolved),
    false,
    'saving before the reload would compare against a guessed hash'
  );
});

// --- read-only and missing -----------------------------------------------------

test('a read-only document cannot be edited into a dirty state', () => {
  const state = editor.createEditorState(readFixture({ readOnly: true }));
  assert.equal(state.status, 'read-only');
  const after = editor.applyEdit(state, 'attempted edit');
  assert.equal(after, state, 'the edit is refused rather than queued');
  assert.equal(editor.canSave(after), false);
});

test('an externally deleted file leaves the draft recoverable but unsavable', () => {
  const dirty = editor.applyEdit(clean(), 'work in progress');
  const state = editor.applyMissing(dirty, 'The file no longer exists.');

  assert.equal(state.status, 'file-moved-or-missing');
  assert.equal(state.draft, 'work in progress', 'the draft is not discarded');
  assert.equal(
    editor.canSave(state),
    false,
    'a missing file is not silently recreated by a save'
  );
});

// --- dirty tracking -----------------------------------------------------------

test('editing back to the original content clears the dirty flag', () => {
  let state = editor.applyEdit(clean(), 'changed');
  assert.equal(state.status, 'unsaved-draft');

  state = editor.applyEdit(state, 'original content');
  assert.equal(editor.isDirty(state), false);
  assert.equal(state.status, 'saved-to-repo');
});

test('an unrelated edit does not change the baseline', () => {
  let state = clean();
  for (const text of ['a', 'ab', 'abc', 'abcd']) {
    state = editor.applyEdit(state, text);
  }
  assert.equal(state.baseline.content, 'original content');
  assert.equal(state.baseline.hash, 'hash-1');
  assert.equal(state.draft, 'abcd');
});

test('editing while in conflict does not silently leave the conflict', () => {
  const dirty = editor.applyEdit(clean(), 'mine');
  const conflicted = editor.applyExternalChange(dirty, {
    newContent: 'theirs',
    newHash: 'hash-external',
    newSize: 6,
    newMtimeMs: 3000,
  });

  const stillConflicted = editor.applyEdit(conflicted, 'mine edited further');
  assert.equal(
    stillConflicted.status,
    'conflict-review-needed',
    'typing must not dismiss a conflict the reader has not resolved'
  );
  assert.equal(stillConflicted.draft, 'mine edited further');
  assert.equal(stillConflicted.externalContent, 'theirs');
});

// --- failure descriptions -----------------------------------------------------

test('every write failure reason has a plain-English description', () => {
  const reasons = [
    'no-such-root',
    'outside-root',
    'not-a-regular-file',
    'read-only',
    'too-large',
    'hash-mismatch',
    'file-missing',
    'io-error',
  ];
  for (const reason of reasons) {
    const description = editor.describeWriteFailure(reason);
    assert.equal(typeof description, 'string');
    assert.ok(description.length > 10, `too terse for ${reason}`);
    assert.ok(
      /[.!]$/.test(description),
      `should read as a sentence for ${reason}`
    );
  }
});

test('the conflict description does not claim a save succeeded', () => {
  const dirty = editor.applyEdit(clean(), 'mine');
  const conflicted = editor.applyExternalChange(dirty, {
    newContent: 'theirs',
    newHash: 'h',
    newSize: 5,
    mtimeMs: 1,
  });
  for (const text of [conflicted.lastFailure, conflicted.status]) {
    assert.ok(!/sync/i.test(String(text)), 'must never say "synced"');
  }
});

// --- status vocabulary --------------------------------------------------------

test('the six states are exactly the agreed vocabulary', async () => {
  // A seven- state UI, or a renamed state, would mean the reader is being told
  // something different from what the briefing agreed.
  const shared = await loadSharedTypes();
  assert.deepEqual(Object.keys(shared.LABOS_STATUS_LABELS).sort(), [
    'conflict-review-needed',
    'file-moved-or-missing',
    'read-only',
    'saved-to-repo',
    'unsaved-draft',
    'updated-elsewhere',
  ]);
  assert.equal(shared.LABOS_STATUS_LABELS['conflict-review-needed'], 'Conflict — review needed');
  assert.equal(shared.LABOS_STATUS_LABELS['file-moved-or-missing'], 'File moved/missing');
});

async function loadSharedTypes() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/apps/electron/src/shared/labos-repo.ts'
  );
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}
