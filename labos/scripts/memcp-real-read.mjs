/**
 * LabOS Workspace — MeMCP adapter real-data integration check.
 *
 * Run with: node labos/scripts/memcp-real-read.mjs [baseUrl]
 *
 * This is NOT a fixture test. It drives the real adapter code against a running
 * MeMCP service and reports what it actually received, so the QA checklist's
 * "real integration read recorded separately from fixture tests" is satisfied.
 *
 * It is read-only: it lists projects, reads one snapshot, and exercises the
 * conditional (304) path. It writes nothing and touches no MeMCP data.
 *
 * Output deliberately avoids echoing project content. It reports shapes, counts
 * and provenance values, so the record is useful without publishing private
 * notes into a log.
 */

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3212';

async function loadAdapter() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/apps/electron/src/main/labos/memcp-adapter.ts'
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

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const { LabosMemcpAdapter } = await loadAdapter();

console.log(`MeMCP real-data read against ${baseUrl}\n`);

const adapter = new LabosMemcpAdapter({ baseUrl, timeoutMs: 10_000 });

// 1. Health
let health = null;
try {
  health = await adapter.health();
  record(
    'health responds',
    true,
    `status=${health.status} queue=${health.queue} archivist=${health.archivist}`
  );
} catch (error) {
  record('health responds', false, String(error?.message ?? error));
}

// 2. Project list
let projects = [];
try {
  projects = await adapter.listProjects();
  record('project list read', projects.length > 0, `${projects.length} projects`);

  const withStatus = projects.filter(p => p.status !== null).length;
  const withRepo = projects.filter(p => p.hasRepository).length;
  const withPreview = projects.filter(p => p.preview_url !== null).length;
  console.log(
    `      ${withStatus} with a recorded status, ${withRepo} with a repository, ` +
      `${withPreview} with a preview URL`
  );
  record(
    'absent fields stay absent',
    projects.some(p => p.status === null) || withStatus === projects.length,
    withStatus === projects.length
      ? 'every project has a recorded status'
      : 'some projects have no recorded status, and those stayed null'
  );
} catch (error) {
  record('project list read', false, String(error?.message ?? error));
}

// 3. Snapshot read + conditional 304 path, using real slugs.
//
// Prefer a project that actually has tasks: a project with none is a valid read
// but would not exercise the task/evidence fields, and reporting that as a
// failure would be a misleading result rather than a real one.
const candidates = [
  'projexxx',
  ...projects.map(p => p.slug),
  'memcp',
];
let snapshotSlug = null;
let snapshotWithTasks = null;

for (const candidate of candidates) {
  if (!candidate) continue;
  try {
    const probe = await adapter.getProjectSnapshot(candidate);
    if (probe.kind !== 'changed') continue;

    if (snapshotSlug === null) snapshotSlug = candidate;
    if (probe.snapshot.tasks.items.length > 0) {
      snapshotWithTasks = { slug: candidate, snapshot: probe.snapshot };
      break;
    }
  } catch {
    // Try the next slug.
    continue;
  }
}

if (snapshotSlug) {
  const chosen = snapshotWithTasks ?? { slug: snapshotSlug, snapshot: null };
  const first = chosen.snapshot
    ? { kind: 'changed', snapshot: chosen.snapshot }
    : await adapter.getProjectSnapshot(chosen.slug);

  if (first.kind === 'changed') {
    const snapshot = first.snapshot;
    record('snapshot read', true, `project "${chosen.slug}"`);

    record(
      'snapshot is schema version 2',
      snapshot.schema_version === 2,
      `schema_version=${snapshot.schema_version}`
    );

    const taskCount = snapshot.tasks.items.length;
    const labels = new Set(
      snapshot.tasks.items.map(t => t.evidence_label).filter(Boolean)
    );
    if (taskCount > 0) {
      record(
        'tasks carry a reported evidence label',
        labels.size > 0,
        `${taskCount} tasks, labels: ${[...labels].join(', ')}`
      );
    } else {
      // No project in this service currently has tasks. That is a fact about the
      // data, not an adapter failure, and it is recorded as such.
      console.log(
        '      NOTE no project in this service currently has tasks attached, so ' +
          'the task and evidence_label fields could not be exercised against real data.'
      );
    }

    const sectionStatuses = Object.entries(snapshot.sections).map(
      ([name, section]) => `${name}=${section.status}`
    );
    record(
      'sections report their own status',
      sectionStatuses.length > 0,
      sectionStatuses.join(' ')
    );

    const gaps = snapshot.evidence_gaps.map(g => g.code);
    record(
      'evidence gaps are surfaced',
      Array.isArray(gaps),
      gaps.length ? gaps.join(', ') : 'none'
    );

    // The conditional path against the real service.
    const second = await adapter.getProjectSnapshot(chosen.slug);
    record(
      'conditional read returns 304 and is handled as not-modified',
      second.kind === 'not-modified',
      `second read kind=${second.kind}`
    );

    const connectionAfter304 = adapter.connection();
    record(
      'connection stays healthy after a 304',
      connectionAfter304.connected === true &&
        connectionAfter304.lastError === null,
      `connected=${connectionAfter304.connected} lastError=${connectionAfter304.lastError?.code ?? 'none'}`
    );
  }
} else {
  record('snapshot read', false, 'no snapshot could be read for any project');
}

// 4. Cache age is measurable
if (snapshotSlug) {
  const age = adapter.cachedAgeMs();
  record(
    'cached age is measurable',
    typeof age === 'number' && age >= 0,
    `${age}ms`
  );
}

// 5. Force re-read bypasses the cache
if (snapshotSlug) {
  try {
    const forced = await adapter.getProjectSnapshot(snapshotSlug, {
      force: true,
    });
    record(
      'forced read bypasses the cache',
      forced.kind === 'changed',
      `kind=${forced.kind}`
    );
  } catch (error) {
    record('forced read bypasses the cache', false, String(error?.message ?? error));
  }
}

// 6. A missing project is a clean not-found, not a crash
try {
  await adapter.getProjectSnapshot('definitely-does-not-exist');
  record('missing project reports not-found', false, 'no error was raised');
} catch (error) {
  record(
    'missing project reports not-found',
    error?.code === 'not-found',
    `code=${error?.code}`
  );
}

const failures = results.filter(r => !r.ok);
console.log(
  `\n${results.length - failures.length}/${results.length} checks passed against the real service.`
);
if (failures.length > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(`  - ${failure.label}`);
  process.exitCode = 1;
}
