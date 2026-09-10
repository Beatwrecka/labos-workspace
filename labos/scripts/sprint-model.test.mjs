/**
 * LabOS Workspace — sprint and project presentation tests.
 *
 * Run with: node --test labos/scripts/sprint-model.test.mjs
 *
 * The central property under test is the one the briefing is most specific
 * about: reported status, tests, independent QA, merge state and cleanup must
 * NOT be conflated, and a missing record must say "not recorded" rather than
 * looking like a pass.
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
    'packages/frontend/core/src/modules/labos-repo/sprint-model.ts'
  );
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}

const model = await loadModel();

/** A synthetic snapshot; no real project data is involved. */
function snapshot(overrides = {}) {
  return {
    schema_version: 2,
    as_of: '2026-09-01T10:00:00.000Z',
    source_fingerprint: 'fp',
    project: {
      id: 'p1',
      name: 'Synthetic',
      slug: 'synthetic',
      status: 'active',
      category: 'tools',
      summary: 'Synthetic project.',
      next_action_override: null,
      visual_evidence_mode: 'unknown',
      cover_preview_id: null,
      repository: { binding: 'bound', availability: 'not_checked', remote: null },
    },
    sections: {
      purpose: { status: 'available', provenance: 'explicit', items: [], omitted_count: 0, note: null, text: 'Synthetic project.' },
      current_state: { status: 'unknown', provenance: 'unknown', items: [], omitted_count: 0, note: 'Nothing recorded.' },
      what_works: { status: 'unknown', provenance: 'unknown', items: [], omitted_count: 0, note: 'Nothing recorded.' },
      blockers: { status: 'unknown', provenance: 'unknown', items: [], omitted_count: 0, note: 'Nothing recorded.' },
      latest_changes: { status: 'unknown', provenance: 'unknown', items: [], omitted_count: 0, note: 'No changes recorded.' },
      screenshots: { status: 'unknown', provenance: 'unknown', items: [], total: 0, omitted_count: 0, note: 'No visual evidence.' },
    },
    tasks: { status_counts: {}, total: 0, items: [], omitted_count: 0 },
    resume_action: {
      type: 'record_next_action',
      label: 'Record the next action',
      task_id: null,
      rule: 'record_next_action',
      provenance: 'unknown',
    },
    evidence_gaps: [],
    coverage: {
      accepted_memories: 0,
      selected_memories: 0,
      tracked_tasks: 0,
      selected_tasks: 0,
      meaningful_changes: 0,
      selected_changes: 0,
      visual_evidence: 'missing',
    },
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 't1',
    slug: 'a-task',
    title: 'A task',
    status: 'completed',
    sprint_label: 'Sprint 1',
    phase_title: 'Phase A',
    updated_at: '2026-09-01T09:00:00.000Z',
    completed_at: '2026-09-01T09:00:00.000Z',
    source_path: 'TASKS.md',
    source_sha: null,
    evidence_label: 'reported_complete',
    ...overrides,
  };
}

// --- the four dimensions stay separate ---------------------------------------

test('a completed task is reported complete, never verified', () => {
  const result = model.buildSprintEvidence(task(), snapshot());
  assert.equal(result.reportedStatus.label, 'Completed (reported)');
  assert.equal(result.reportedStatus.evidenceLabel, 'reported_complete');
  assert.ok(
    !/verified|passed|proven/i.test(result.reportedStatus.label),
    'the reported label must not imply verification'
  );
});

test('a completed task with no test record does NOT look like passing tests', () => {
  const evidence = model.buildSprintEvidence(task(), snapshot());
  assert.equal(evidence.tests.state, 'not-recorded');
  assert.match(evidence.tests.detail, /not test evidence/i);
  assert.equal(evidence.tests.provenance, 'unknown');
});

test('no independent QA record is stated as unverified, not as reviewed', () => {
  const evidence = model.buildSprintEvidence(task(), snapshot());
  assert.equal(evidence.independentQa.state, 'not-recorded');
  assert.match(evidence.independentQa.detail, /self-review is not independent/i);
});

test('a merged state is not claimed from a commit alone', () => {
  const withCommit = snapshot({
    sections: {
      ...snapshot().sections,
      latest_changes: {
        status: 'available',
        provenance: 'verified_at_source',
        items: [
          {
            id: 'c1',
            kind: 'git_commit',
            title: 'A commit',
            summary: 'Git source abc12345.',
            occurred_at: '2026-09-01T09:45:00.000Z',
            provenance: 'verified_at_source',
            source_sha: 'abc12345'.padEnd(40, '0'),
          },
        ],
        omitted_count: 0,
        note: null,
      },
    },
  });

  const evidence = model.buildSprintEvidence(task(), withCommit);
  assert.equal(evidence.integration.state, 'merged');
  assert.match(
    evidence.integration.detail,
    /not proof of merge into the integration branch/i,
    'a recorded commit must not be presented as a verified merge'
  );
});

test('cleanup is a separate dimension from merge, not inferred from it', () => {
  const evidence = model.buildSprintEvidence(task(), snapshot());
  assert.equal(evidence.cleanup.state, 'not-recorded');
  assert.match(evidence.cleanup.detail, /cleanup/i);
});

test('the four dimensions cannot all be satisfied by one reported status', () => {
  // The whole point: a reported completion satisfies ONE dimension and leaves
  // the others explicitly unrecorded. If a future change made a completed task
  // produce evidence for tests or QA, this test fails.
  const evidence = model.buildSprintEvidence(
    task({ status: 'completed', evidence_label: 'reported_complete' }),
    snapshot()
  );

  assert.equal(evidence.reportedStatus.evidenceLabel, 'reported_complete');
  assert.equal(evidence.tests.state, 'not-recorded');
  assert.equal(evidence.independentQa.state, 'not-recorded');
  assert.equal(evidence.integration.state, 'not-recorded');
  assert.equal(evidence.cleanup.state, 'not-recorded');
});

test('a blocked task is reported blocked and surfaces as needing attention', () => {
  const cards = model.buildSprintCards(
    snapshot({
      tasks: {
        status_counts: { blocked: 1 },
        total: 1,
        items: [
          task({
            status: 'blocked',
            evidence_label: 'reported_blocked',
            completed_at: null,
            title: 'Stuck task',
          }),
        ],
        omitted_count: 0,
      },
    })
  );

  assert.equal(cards.length, 1);
  assert.equal(cards[0].evidence.reportedStatus.label, 'Blocked (reported)');
  assert.ok(cards[0].needsYou, 'a blocked task must appear in "Needs you"');
  assert.match(cards[0].needsYou, /Stuck task/);
});

test('status labels never use the word verified', () => {
  for (const status of ['completed', 'blocked', 'in_progress', 'planned', 'skipped']) {
    const label = model.describeReportedStatus('reported_status', status);
    assert.ok(
      !/verified|proven/i.test(label),
      `label must not claim verification: ${label}`
    );
  }
});

// --- sprint structure honesty --------------------------------------------------

test('tasks with no sprint labels are reported as lacking sprint structure', () => {
  const noStructure = snapshot({
    tasks: {
      status_counts: {},
      total: 1,
      items: [
        task({ sprint_label: null, phase_title: null }),
      ],
      omitted_count: 0,
    },
  });
  assert.equal(model.lacksSprintStructure(noStructure), true);
});

test('tasks WITH sprint labels do not report a missing structure', () => {
  const structured = snapshot({
    tasks: {
      status_counts: {},
      total: 1,
      items: [task({ sprint_label: 'Sprint 1' })],
      omitted_count: 0,
    },
  });
  assert.equal(model.lacksSprintStructure(structured), false);
});

test('an unknown section reads as nothing recorded, not as empty-and-fine', () => {
  const summary = model.summariseSection({
    status: 'unknown',
    provenance: 'unknown',
    items: [],
    omitted_count: 0,
    note: 'No accepted project-state memory has been recorded.',
  });
  assert.match(summary, /no accepted project-state memory/i);
});

test('an omitted count is surfaced rather than silently dropped', () => {
  const summary = model.summariseSection({
    status: 'partial',
    provenance: 'reported',
    items: [{ title: 'One' }, { title: 'Two' }],
    omitted_count: 5,
    note: null,
  });
  assert.match(summary, /One; Two/);
  assert.match(summary, /5 more omitted/);
});

test('cards carry the snapshot evidence gaps so the UI can state them', () => {
  const gaps = [
    {
      code: 'functional_proof_not_recorded',
      section: 'what_works',
      message: 'Reported status is not proof.',
    },
  ];
  const cards = model.buildSprintCards(
    snapshot({
      tasks: { status_counts: {}, total: 1, items: [task()], omitted_count: 0 },
      evidence_gaps: gaps,
    })
  );
  assert.deepEqual(cards[0].gaps, gaps);
});

test('the next action comes from MeMCP and keeps its provenance', () => {
  const cards = model.buildSprintCards(
    snapshot({
      tasks: { status_counts: {}, total: 1, items: [task({ id: 't1' })], omitted_count: 0 },
      resume_action: {
        type: 'task',
        label: 'Resume: A task',
        task_id: 't1',
        rule: 'in_progress_first',
        provenance: 'verified_at_source',
      },
    })
  );
  assert.ok(cards[0].nextAction);
  assert.equal(cards[0].nextAction.label, 'Resume: A task');
  assert.equal(cards[0].nextAction.provenance, 'verified_at_source');
});

test('a card that is not the resume target has no invented next action', () => {
  const cards = model.buildSprintCards(
    snapshot({
      tasks: {
        status_counts: {},
        total: 2,
        items: [task({ id: 't1' }), task({ id: 't2', title: 'Other' })],
        omitted_count: 0,
      },
      resume_action: {
        type: 'task',
        label: 'Resume: A task',
        task_id: 't1',
        rule: 'in_progress_first',
        provenance: 'verified_at_source',
      },
    })
  );
  const other = cards.find(card => card.id === 't2');
  assert.equal(other.nextAction, null, 'no next action may be invented');
});

// --- covers -------------------------------------------------------------------

test('a recorded preview URL becomes the cover', () => {
  const cover = model.buildProjectCover({
    previewUrl: 'http://127.0.0.1:3210/thing.png',
    coverPreviewId: 'pv1',
    visualEvidenceMode: 'expected',
    slug: 'p',
  });
  assert.equal(cover.kind, 'recorded');
  assert.equal(cover.previewUrl, 'http://127.0.0.1:3210/thing.png');
  assert.equal(cover.previewId, 'pv1');
});

test('a missing cover explains itself rather than being a bare placeholder', () => {
  const cover = model.buildProjectCover({
    previewUrl: null,
    coverPreviewId: null,
    visualEvidenceMode: 'unknown',
    slug: 'p',
  });
  assert.equal(cover.kind, 'placeholder');
  assert.equal(cover.previewUrl, null);
  assert.ok(
    cover.reason && cover.reason.length > 20,
    'the placeholder must say why it is empty'
  );
});

test('visual evidence marked not-applicable says so specifically', () => {
  const cover = model.buildProjectCover({
    previewUrl: null,
    coverPreviewId: null,
    visualEvidenceMode: 'not_applicable',
    slug: 'p',
  });
  assert.match(cover.reason, /not applicable/i);
});

// --- ordering and the shortlist ------------------------------------------------

test('cards are ordered by meaningful work, not by when we last polled', () => {
  const ordered = model.orderByMeaningfulWork([
    { updatedAt: '2026-09-01T10:00:00.000Z', slug: 'older' },
    { updatedAt: '2026-09-03T10:00:00.000Z', slug: 'newest' },
    { updatedAt: '2026-09-02T10:00:00.000Z', slug: 'middle' },
  ]);
  assert.deepEqual(ordered.map(p => p.slug), ['newest', 'middle', 'older']);
});

test('the shortlist order wins, and everything else follows', () => {
  const projects = [
    { slug: 'a', updatedAt: '2026-09-01T00:00:00.000Z' },
    { slug: 'b', updatedAt: '2026-09-03T00:00:00.000Z' },
    { slug: 'c', updatedAt: '2026-09-02T00:00:00.000Z' },
  ];
  const ordered = model.applyShortlistOrder(projects, ['a']);
  assert.deepEqual(
    ordered.map(p => p.slug),
    ['a', 'b', 'c'],
    'the chosen project is first, the rest by meaningful work'
  );
});

test('a shortlist of several projects is honoured in the chosen order', () => {
  const projects = [
    { slug: 'a', updatedAt: '2026-09-01T00:00:00.000Z' },
    { slug: 'b', updatedAt: '2026-09-02T00:00:00.000Z' },
    { slug: 'c', updatedAt: '2026-09-03T00:00:00.000Z' },
  ];
  const ordered = model.applyShortlistOrder(projects, ['a', 'c']);
  assert.deepEqual(ordered.map(p => p.slug), ['a', 'c', 'b']);
});

test('a shortlist entry for a removed project is skipped, not shown as a ghost', () => {
  const projects = [{ slug: 'b', updatedAt: '2026-09-01T00:00:00.000Z' }];
  const ordered = model.applyShortlistOrder(projects, ['gone', 'b']);
  assert.deepEqual(ordered.map(p => p.slug), ['b']);
});

test('a duplicated shortlist entry is not shown twice', () => {
  const projects = [
    { slug: 'a', updatedAt: '2026-09-01T00:00:00.000Z' },
    { slug: 'b', updatedAt: '2026-09-02T00:00:00.000Z' },
  ];
  const ordered = model.applyShortlistOrder(projects, ['a', 'a']);
  assert.deepEqual(ordered.map(p => p.slug), ['a', 'b']);
});

test('an empty shortlist leaves meaningful-work order intact', () => {
  const projects = [
    { slug: 'a', updatedAt: '2026-09-01T00:00:00.000Z' },
    { slug: 'b', updatedAt: '2026-09-02T00:00:00.000Z' },
  ];
  assert.deepEqual(
    model.applyShortlistOrder(projects, []).map(p => p.slug),
    ['b', 'a']
  );
});

// --- reordering (the keyboard path) -------------------------------------------

test('moving an item down and up reorders correctly', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.deepEqual(model.moveItem(items, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(model.moveItem(items, 3, 1), ['a', 'd', 'b', 'c']);
});

test('moving to the same position changes nothing', () => {
  const items = ['a', 'b', 'c'];
  assert.deepEqual(model.moveItem(items, 1, 1), ['a', 'b', 'c']);
});

test('an out-of-range move is a safe no-op, not a corrupted list', () => {
  const items = ['a', 'b', 'c'];
  assert.deepEqual(model.moveItem(items, -1, 1), ['a', 'b', 'c']);
  assert.deepEqual(model.moveItem(items, 5, 1), ['a', 'b', 'c']);
  assert.deepEqual(model.moveItem(items, 0, 9), ['a', 'b', 'c']);
});

test('moving does not mutate the original list', () => {
  const items = ['a', 'b', 'c'];
  const moved = model.moveItem(items, 0, 2);
  assert.deepEqual(items, ['a', 'b', 'c'], 'the input is untouched');
  assert.notEqual(moved, items, 'a new array is returned');
});

test('reordering is stable: repeated moves produce the expected permutation', () => {
  let order = ['a', 'b', 'c', 'd'];
  order = model.moveItem(order, 0, 3); // moving 'a' to the end
  assert.deepEqual(order, ['b', 'c', 'd', 'a']);
  order = model.moveItem(order, 3, 0); // moving it back to the front
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'the reverse move restores order');
});
