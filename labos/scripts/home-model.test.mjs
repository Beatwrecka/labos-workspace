/**
 * LabOS Workspace — home screen model tests.
 *
 * Run with: node --test labos/scripts/home-model.test.mjs
 *
 * The property that matters most: "Needs you" must not be padded. A list that
 * includes things which do not actually need the reader stops being read, which
 * makes it worse than no list at all. So the tests assert both that real
 * blockers appear AND that nothing else does.
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

async function loadModel() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/core/src/modules/labos-repo/home-model.ts'
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

const model = await loadModel();

const doc = (overrides = {}) => ({
  rootId: 'r1',
  rootLabel: 'Repo',
  relativePath: 'docs/note.md',
  lastOpenedAt: '2026-09-01T10:00:00.000Z',
  status: 'saved-to-repo',
  ...overrides,
});

const project = (overrides = {}) => ({
  slug: 'alpha',
  name: 'Alpha',
  summary: 'A project.',
  status: 'active',
  lastMeaningfulWorkAt: '2026-09-01T10:00:00.000Z',
  pinned: false,
  ...overrides,
});

const change = (overrides = {}) => ({
  id: 'c1',
  title: 'A change',
  summary: 'Something happened.',
  occurredAt: '2026-09-01T10:00:00.000Z',
  provenance: 'reported',
  projectSlug: 'alpha',
  ...overrides,
});

// --- continue writing ----------------------------------------------------------

test('the most recently opened document is offered to continue', () => {
  const result = model.pickContinueWriting(
    [
      doc({ relativePath: 'older.md', lastOpenedAt: '2026-09-01T09:00:00.000Z' }),
      doc({ relativePath: 'newest.md', lastOpenedAt: '2026-09-03T09:00:00.000Z' }),
    ],
    1
  );
  assert.equal(result.document.relativePath, 'newest.md');
  assert.equal(result.reason, null);
});

test('with no folders registered, the slot explains why instead of being blank', () => {
  const result = model.pickContinueWriting([], 0);
  assert.equal(result.document, null);
  assert.match(result.reason, /no repository folder has been added/i);
});

test('with folders but nothing opened, it says that specifically', () => {
  const result = model.pickContinueWriting([], 2);
  assert.equal(result.document, null);
  assert.match(result.reason, /no repository document has been opened/i);
});

test('a moved-or-missing document is NOT offered as continue-writing', () => {
  // Offering to continue a file that is gone is a broken promise.
  const result = model.pickContinueWriting(
    [doc({ relativePath: 'gone.md', status: 'file-moved-or-missing' })],
    1
  );
  assert.equal(result.document, null);
  assert.match(result.reason, /moved or gone missing/i);
});

test('a document in conflict is still continuable, since the draft survives', () => {
  const result = model.pickContinueWriting(
    [doc({ status: 'conflict-review-needed' })],
    1
  );
  assert.ok(result.document, 'a conflict keeps the draft, so it is continuable');
});

test('an unsaved draft is offered back to the reader', () => {
  const result = model.pickContinueWriting(
    [doc({ status: 'unsaved-draft' })],
    1
  );
  assert.equal(result.document.status, 'unsaved-draft');
});

// --- priority projects ----------------------------------------------------------

test('the shortlist comes first, in the reader\'s order', () => {
  const result = model.pickPriorityProjects(
    [
      project({ slug: 'a', lastMeaningfulWorkAt: '2026-09-05T00:00:00.000Z' }),
      project({ slug: 'b', lastMeaningfulWorkAt: '2026-09-01T00:00:00.000Z' }),
      project({ slug: 'c', lastMeaningfulWorkAt: '2026-09-03T00:00:00.000Z' }),
    ],
    ['b', 'c']
  );
  assert.deepEqual(
    result.map(p => p.slug),
    ['b', 'c', 'a'],
    'pinned projects keep their order; the rest follow by meaningful work'
  );
});

test('without a shortlist, projects sort by meaningful work', () => {
  const result = model.pickPriorityProjects(
    [
      project({ slug: 'old', lastMeaningfulWorkAt: '2026-09-01T00:00:00.000Z' }),
      project({ slug: 'new', lastMeaningfulWorkAt: '2026-09-08T00:00:00.000Z' }),
    ],
    []
  );
  assert.deepEqual(result.map(p => p.slug), ['new', 'old']);
});

test('a project with no recorded work timestamp sorts last, not first', () => {
  const result = model.pickPriorityProjects(
    [
      project({ slug: 'unknown', lastMeaningfulWorkAt: null }),
      project({ slug: 'known', lastMeaningfulWorkAt: '2026-09-01T00:00:00.000Z' }),
    ],
    []
  );
  assert.deepEqual(
    result.map(p => p.slug),
    ['known', 'unknown'],
    'an unknown timestamp must not be treated as "very recent"'
  );
});

test('a shortlist entry for a removed project is skipped', () => {
  const result = model.pickPriorityProjects([project({ slug: 'a' })], ['gone', 'a']);
  assert.deepEqual(result.map(p => p.slug), ['a']);
});

test('the priority list is bounded', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    project({ slug: `p${i}`, lastMeaningfulWorkAt: `2026-09-${(i % 9) + 1}T00:00:00.000Z` })
  );
  assert.ok(model.pickPriorityProjects(many, [], 6).length <= 6);
});

// --- recent work -----------------------------------------------------------------

test('recent work is ordered by when it happened, newest first', () => {
  const result = model.pickRecentWork([
    change({ id: 'a', occurredAt: '2026-09-01T00:00:00.000Z' }),
    change({ id: 'c', occurredAt: '2026-09-05T00:00:00.000Z' }),
    change({ id: 'b', occurredAt: '2026-09-03T00:00:00.000Z' }),
  ]);
  assert.deepEqual(result.map(c => c.id), ['c', 'b', 'a']);
});

test('recent work is NOT ordered by when LabOS fetched it', () => {
  // The distinction the briefing draws: sort by the work's own timestamp, not
  // by a polling timestamp. Here the older change was fetched last.
  const result = model.pickRecentWork([
    change({ id: 'fetched-last-but-old', occurredAt: '2026-01-01T00:00:00.000Z' }),
    change({ id: 'fetched-first-but-new', occurredAt: '2026-09-09T00:00:00.000Z' }),
  ]);
  assert.equal(result[0].id, 'fetched-first-but-new');
});

test('a change with no timestamp is dropped rather than shown at the top', () => {
  const result = model.pickRecentWork([
    change({ id: 'undated', occurredAt: '' }),
    change({ id: 'dated', occurredAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(result.map(c => c.id), ['dated']);
});

test('recent work keeps provenance so reported never reads as verified', () => {
  const result = model.pickRecentWork([
    change({ id: 'r', provenance: 'reported' }),
    change({ id: 'v', provenance: 'verified_at_source' }),
  ]);
  assert.equal(result.find(c => c.id === 'r').provenance, 'reported');
  assert.equal(result.find(c => c.id === 'v').provenance, 'verified_at_source');
});

test('recent work is bounded', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    change({ id: `c${i}`, occurredAt: `2026-09-${(i % 28) + 1}T00:00:00.000Z` })
  );
  assert.ok(model.pickRecentWork(many).length <= 6);
});

// --- needs you --------------------------------------------------------------------

test('a blocked task appears in Needs you, with its detail', () => {
  const blockers = model.pickNeedsYou({
    blocks: [
      {
        task: 'Deploy is blocked',
        detail: 'Reported blocked by MeMCP.',
        projectSlug: 'alpha',
      },
    ],
    documents: [],
    unavailableRoots: [],
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].source, 'memcp-task');
  assert.match(blockers[0].title, /Deploy is blocked/);
});

test('a conflicting document appears in Needs you', () => {
  const blockers = model.pickNeedsYou({
    blocks: [],
    documents: [doc({ status: 'conflict-review-needed' })],
    unavailableRoots: [],
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].source, 'repo-document');
  assert.match(blockers[0].detail, /both versions were kept/i);
});

test('a missing file appears in Needs you and mentions the retained draft', () => {
  const blockers = model.pickNeedsYou({
    blocks: [],
    documents: [doc({ status: 'file-moved-or-missing' })],
    unavailableRoots: [],
  });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0].detail, /draft was kept/i);
});

test('an unreadable folder appears in Needs you', () => {
  const blockers = model.pickNeedsYou({
    blocks: [],
    documents: [],
    unavailableRoots: [{ id: 'r1', label: 'Old Repo' }],
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].source, 'repo-root');
  assert.match(blockers[0].title, /Old Repo/);
});

test('a healthy document does NOT appear in Needs you', () => {
  // The anti-padding property: saved documents, unsaved drafts and read-only
  // documents are all normal states and must not be escalated.
  const blockers = model.pickNeedsYou({
    blocks: [],
    documents: [
      doc({ status: 'saved-to-repo' }),
      doc({ relativePath: 'b.md', status: 'unsaved-draft' }),
      doc({ relativePath: 'c.md', status: 'read-only' }),
      doc({ relativePath: 'd.md', status: 'updated-elsewhere' }),
      doc({ relativePath: 'e.md', status: null }),
    ],
    unavailableRoots: [],
  });
  assert.deepEqual(
    blockers,
    [],
    'ordinary states must not be presented as needing attention'
  );
});

test('an empty Needs you stays empty rather than being filled with noise', () => {
  const blockers = model.pickNeedsYou({
    blocks: [],
    documents: [doc()],
    unavailableRoots: [],
  });
  assert.deepEqual(blockers, []);
});

test('Needs you is bounded so it stays readable', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    task: `Blocked ${i}`,
    detail: 'Reported blocked.',
    projectSlug: 'p',
  }));
  assert.ok(model.pickNeedsYou({ blocks: many, documents: [], unavailableRoots: [] }).length <= 5);
});

test('Needs you orders tasks before documents before folders', () => {
  const blockers = model.pickNeedsYou({
    blocks: [{ task: 'Blocked task', detail: 'd', projectSlug: 'p' }],
    documents: [doc({ status: 'conflict-review-needed' })],
    unavailableRoots: [{ id: 'r', label: 'Missing folder' }],
  });
  assert.deepEqual(
    blockers.map(b => b.source),
    ['memcp-task', 'repo-document', 'repo-root']
  );
});

// --- assembly ---------------------------------------------------------------------

test('the assembled home state reports its sources honestly', () => {
  const state = model.buildHomeState({
    repoDocuments: [doc()],
    rootsRegistered: 1,
    unavailableRoots: [],
    projects: [project()],
    shortlist: ['alpha'],
    changes: [change()],
    blocks: [],
    memcp: 'disconnected',
  });
  assert.equal(state.sources.memcp, 'disconnected');
  assert.equal(state.sources.repoFolders, 1);
  assert.ok(state.continueWriting.document);
  assert.equal(state.priorityProjects.length, 1);
});

test('a disconnected MeMCP leaves the repo half of the home screen working', () => {
  // The briefing requires that notes and repo documents keep working when MeMCP
  // is down, so the home screen must not collapse.
  const state = model.buildHomeState({
    repoDocuments: [doc({ status: 'unsaved-draft' })],
    rootsRegistered: 1,
    unavailableRoots: [],
    projects: [],
    shortlist: [],
    changes: [],
    blocks: [],
    memcp: 'disconnected',
  });
  assert.ok(
    state.continueWriting.document,
    'continue-writing must still be offered'
  );
  assert.deepEqual(state.priorityProjects, []);
  assert.deepEqual(state.needsYou, []);
  assert.equal(state.sources.memcp, 'disconnected');
});

test('cached MeMCP data is reported as cached, not as connected', () => {
  const state = model.buildHomeState({
    repoDocuments: [],
    rootsRegistered: 0,
    unavailableRoots: [],
    projects: [project()],
    shortlist: [],
    changes: [],
    blocks: [],
    memcp: 'cached',
  });
  assert.equal(state.sources.memcp, 'cached');
});
