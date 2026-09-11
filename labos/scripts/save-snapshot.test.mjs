/**
 * Regression: a save acknowledgement confirms the submitted text, not edits
 * typed while the IPC request was in flight. Run with the existing LabOS suite:
 * node --test labos/scripts/*.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ts = require(path.join(root, 'node_modules/typescript/lib/typescript.js'));
const sourcePath = path.join(
  root,
  'packages/frontend/core/src/modules/labos-repo/editor-state.ts'
);
const { outputText } = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const editor = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);
const clean = () => editor.createEditorState({
  content: 'original', hash: 'hash-original', size: 8, mtimeMs: 1, readOnly: false,
});
const start = (text = 'submitted') => editor.beginSave(editor.applyEdit(clean(), text));
const success = { ok: true, hash: 'hash-submitted', size: 9, mtimeMs: 2 };

test('later typing is retained and is not falsely acknowledged as saved', () => {
  const pending = start();
  const latest = editor.applyEdit(pending, 'submitted plus more typing');
  const result = editor.applySaveResult(latest, success);
  assert.equal(result.baseline.content, 'submitted');
  assert.equal(result.baseline.hash, 'hash-submitted');
  assert.equal(result.draft, 'submitted plus more typing');
  assert.equal(result.status, 'unsaved-draft');
  assert.equal(editor.canSave(result), true);
  assert.equal(result.saving, false);
});

test('unchanged submitted text becomes clean after confirmation', () => {
  const result = editor.applySaveResult(start(), success);
  assert.equal(result.status, 'saved-to-repo');
  assert.equal(editor.isDirty(result), false);
  assert.equal(result.pendingSaveContent, null);
});

test('returning to the old baseline during a save remains unconfirmed', () => {
  const latest = editor.applyEdit(start(), 'original');
  assert.notEqual(latest.status, 'saved-to-repo');
  const result = editor.applySaveResult(latest, success);
  assert.equal(result.draft, 'original');
  assert.equal(result.baseline.content, 'submitted');
  assert.equal(editor.canSave(result), true);
});

test('an empty submitted document is a real snapshot, not a missing snapshot', () => {
  const result = editor.applySaveResult(editor.applyEdit(start(''), 'new text'), {
    ...success, size: 0,
  });
  assert.equal(result.baseline.content, '');
  assert.equal(result.draft, 'new text');
  assert.equal(result.status, 'unsaved-draft');
});

test('a second beginSave while pending does not replace the submitted snapshot', () => {
  const latest = editor.applyEdit(start(), 'newer');
  assert.equal(editor.beginSave(latest), latest);
  assert.equal(latest.pendingSaveContent, 'submitted');
});

test('the next save captures the newer draft against the confirmed baseline', () => {
  const first = editor.applySaveResult(editor.applyEdit(start(), 'second'), success);
  const second = editor.beginSave(first);
  assert.equal(second.pendingSaveContent, 'second');
  assert.equal(second.baseline.hash, 'hash-submitted');
  const result = editor.applySaveResult(second, {
    ok: true, hash: 'hash-second', size: 6, mtimeMs: 3,
  });
  assert.equal(result.baseline.content, 'second');
  assert.equal(result.status, 'saved-to-repo');
});

test('a reply without a pending request does not invent a saved baseline', () => {
  const state = editor.applyEdit(clean(), 'not submitted');
  assert.equal(editor.applySaveResult(state, success), state);
});

test('a duplicate acknowledgement after completion leaves newer edits alone', () => {
  const saved = editor.applySaveResult(start(), success);
  const latest = editor.applyEdit(saved, 'not submitted');
  assert.equal(editor.applySaveResult(latest, success), latest);
  assert.equal(latest.status, 'unsaved-draft');
});

for (const reason of [
  'no-such-root', 'outside-root', 'not-a-regular-file', 'read-only',
  'too-large', 'hash-mismatch', 'file-missing', 'io-error',
]) {
  test(`${reason} clears the pending snapshot without losing later typing`, () => {
    const latest = editor.applyEdit(start(), 'newer draft');
    const result = editor.applySaveResult(latest, {
      ok: false, reason, message: 'Fixture failure',
    });
    assert.equal(result.draft, 'newer draft');
    assert.equal(result.baseline.content, 'original');
    assert.equal(result.saving, false);
    assert.equal(result.pendingSaveContent, null);
    assert.notEqual(result.status, 'saved-to-repo');
  });
}

test('late success does not clear a newer external-conflict warning', () => {
  const conflict = editor.applyExternalChange(start(), {
    newContent: 'external', newHash: 'hash-external', newSize: 8, newMtimeMs: 3,
  });
  const result = editor.applySaveResult(conflict, success);
  assert.equal(result.status, 'conflict-review-needed');
  assert.equal(result.externalContent, 'external');
  assert.equal(editor.canSave(result), false);
});

test('late success does not clear a newer file-missing warning', () => {
  const missing = editor.applyMissing(start(), 'File was removed.');
  const result = editor.applySaveResult(missing, success);
  assert.equal(result.status, 'file-moved-or-missing');
  assert.equal(result.missingReason, 'File was removed.');
  assert.equal(editor.canSave(result), false);
});

test('beginSave does not bypass existing read-only and conflict restrictions', () => {
  const readOnly = { ...clean(), status: 'read-only' };
  assert.equal(editor.beginSave(readOnly), readOnly);
  const conflict = { ...editor.applyEdit(clean(), 'draft'), status: 'conflict-review-needed' };
  assert.equal(editor.beginSave(conflict), conflict);
});
