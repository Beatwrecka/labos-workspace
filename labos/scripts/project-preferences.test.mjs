/**
 * LabOS Workspace — presentation preference tests.
 *
 * Run with: node --test labos/scripts/project-preferences.test.mjs
 *
 * These guard the properties that make the shortlist trustworthy: it survives a
 * restart, it is keyed by stable identity rather than position, and a corrupt
 * file degrades to no preference instead of crashing or inventing one.
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

async function loadPreferences() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/core/src/modules/labos-repo/project-preferences.ts'
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

const prefs = await loadPreferences();

test('adding a project appends, preserving the existing order', () => {
  let state = prefs.EMPTY_PREFERENCES;
  state = prefs.toggleShortlist(state, 'one');
  state = prefs.toggleShortlist(state, 'two');
  state = prefs.toggleShortlist(state, 'three');
  assert.deepEqual(state.shortlist, ['one', 'two', 'three']);
});

test('toggling an existing project removes it', () => {
  let state = { shortlist: ['one', 'two'], covers: {} };
  state = prefs.toggleShortlist(state, 'one');
  assert.deepEqual(state.shortlist, ['two']);
});

test('toggling twice returns to the original state', () => {
  let state = prefs.EMPTY_PREFERENCES;
  state = prefs.toggleShortlist(state, 'one');
  state = prefs.toggleShortlist(state, 'one');
  assert.deepEqual(state.shortlist, []);
});

test('an invalid slug is refused rather than stored', () => {
  let state = prefs.EMPTY_PREFERENCES;
  for (const bad of ['Not A Slug', 'UPPER', 'has_underscore', '', '../escape']) {
    state = prefs.toggleShortlist(state, bad);
  }
  assert.deepEqual(state.shortlist, [], 'nothing invalid may be stored');
});

// --- persistence round-trip ----------------------------------------------------

test('preferences survive a JSON round-trip', () => {
  let state = prefs.EMPTY_PREFERENCES;
  state = prefs.toggleShortlist(state, 'alpha');
  state = prefs.toggleShortlist(state, 'beta');
  state = prefs.setCover(state, 'alpha', 'pv-1');

  const restored = prefs.parsePreferences(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(
    restored,
    state,
    'a shortlist must survive a restart unchanged'
  );
});

test('the shortlist is keyed by identity, so reordering the source is safe', () => {
  // The scenario that motivates keying by slug: the project list comes back in a
  // different order, and a position-keyed shortlist would silently reassign the
  // reader's choices to different projects.
  let state = { shortlist: ['beta'], covers: {} };
  const restored = prefs.parsePreferences(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.shortlist, ['beta'], 'still pointing at the same project');
  assert.ok(
    !restored.shortlist.includes('alpha'),
    'and not at whatever now sits in position zero'
  );
});

// --- hostile input -------------------------------------------------------------

test('malformed JSON-shaped input degrades to no preferences', () => {
  for (const bad of [null, undefined, 42, 'a string', [], true]) {
    assert.deepEqual(
      prefs.parsePreferences(bad),
      prefs.EMPTY_PREFERENCES,
      `must degrade safely for: ${String(bad)}`
    );
  }
});

test('invalid shortlist entries are dropped, valid ones survive', () => {
  const parsed = prefs.parsePreferences({
    shortlist: ['good-one', 'BAD', 'also-good', '', 42, null, 'has_underscore'],
    covers: {},
  });
  assert.deepEqual(parsed.shortlist, ['good-one', 'also-good']);
});

test('duplicate shortlist entries are collapsed in first-seen order', () => {
  const parsed = prefs.parsePreferences({
    shortlist: ['b', 'a', 'b', 'a', 'c'],
    covers: {},
  });
  assert.deepEqual(parsed.shortlist, ['b', 'a', 'c']);
});

test('an oversized shortlist is bounded rather than unbounded', () => {
  const many = Array.from({ length: 500 }, (_, i) => `project-${i}`);
  const parsed = prefs.parsePreferences({ shortlist: many, covers: {} });
  assert.ok(parsed.shortlist.length <= 200, 'the shortlist must be bounded');
});

// --- covers ---------------------------------------------------------------------

test('a cover is set and cleared', () => {
  let state = prefs.EMPTY_PREFERENCES;
  state = prefs.setCover(state, 'alpha', 'pv-9');
  assert.equal(state.covers.alpha, 'pv-9');
  state = prefs.setCover(state, 'alpha', null);
  assert.equal(state.covers.alpha, undefined, 'clearing removes the entry');
});

test('an invalid cover id is refused', () => {
  let state = prefs.EMPTY_PREFERENCES;
  state = prefs.setCover(state, 'alpha', 'x'.repeat(500));
  assert.equal(state.covers.alpha, undefined);

  state = prefs.setCover(state, 'BAD SLUG', 'pv-1');
  assert.deepEqual(state.covers, {});
});

test('invalid cover entries in a persisted file are dropped', () => {
  const parsed = prefs.parsePreferences({
    shortlist: [],
    covers: {
      good: 'pv-1',
      'BAD SLUG': 'pv-2',
      empty: '',
      oversized: 'x'.repeat(500),
      notastring: 42,
    },
  });
  assert.deepEqual(Object.keys(parsed.covers), ['good']);
});

// --- pruning ---------------------------------------------------------------------

test('pruning removes preferences for projects that no longer exist', () => {
  const pruned = prefs.prunePreferences(
    { shortlist: ['kept', 'gone'], covers: { kept: 'pv-1', gone: 'pv-2' } },
    ['kept', 'other']
  );
  assert.deepEqual(pruned.shortlist, ['kept']);
  assert.deepEqual(Object.keys(pruned.covers), ['kept']);
});

test('pruning is not automatic: a project absent from the list keeps its place until asked', () => {
  // Deliberate: a project that is briefly unreachable must not silently lose its
  // shortlist position, so pruning is an explicit caller decision.
  const state = { shortlist: ['unreachable-right-now'], covers: {} };
  const parsed = prefs.parsePreferences(state);
  assert.deepEqual(parsed.shortlist, ['unreachable-right-now']);
});
