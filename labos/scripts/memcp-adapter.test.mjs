/**
 * LabOS Workspace — MeMCP adapter tests (contract, timeout, stale data).
 *
 * Run with: node --test labos/scripts/memcp-adapter.test.mjs
 *
 * These use SYNTHETIC fixtures shaped to the contract observed in the local
 * MeMCP checkout. No real project data, private source or credentials are
 * involved — the QA checklist requires exactly this separation.
 *
 * The behaviours under test are the ones that decide whether the UI tells the
 * truth: that a missing field stays missing, that a timeout is reported as a
 * timeout, that a 304 is not mistaken for an error, and that cached data is
 * visibly stale rather than presented as current.
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

const mod = await loadAdapter();
const { LabosMemcpAdapter, LabosMemcpError, validateMemcpUrl } = mod;

const BASE = 'http://127.0.0.1:3210';

/** Build a JSON response the way the real service does. */
function jsonResponse(body, { status = 200, etag } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (etag) headers.etag = etag;
  return new Response(JSON.stringify(body), { status, headers });
}

/** A synthetic snapshot with the fields the UI reads. */
function syntheticSnapshot(overrides = {}) {
  return {
    schema_version: 2,
    as_of: '2026-09-01T10:00:00.000Z',
    source_fingerprint: 'fingerprint-one',
    project: {
      id: 'p1',
      name: 'Synthetic Project',
      slug: 'synthetic-project',
      status: 'active',
      category: 'tools',
      summary: 'A synthetic project for tests.',
      next_action_override: null,
      visual_evidence_mode: 'unknown',
      cover_preview_id: null,
      repository: {
        binding: 'bound',
        availability: 'not_checked',
        remote: null,
      },
    },
    sections: {
      purpose: {
        status: 'available',
        provenance: 'explicit',
        items: [],
        omitted_count: 0,
        note: 'Explicit summary.',
        text: 'A synthetic project for tests.',
      },
      current_state: {
        status: 'unknown',
        provenance: 'unknown',
        items: [],
        omitted_count: 0,
        note: 'Nothing recorded.',
      },
      what_works: {
        status: 'available',
        provenance: 'reported',
        items: [
          {
            id: 't2',
            slug: 'task-two',
            title: 'Second task',
            description: 'done',
            status: 'completed',
            sprint_label: 'Sprint 1',
            phase_title: 'Phase A',
            updated_at: '2026-09-01T09:00:00.000Z',
            completed_at: '2026-09-01T09:00:00.000Z',
            source_path: 'TASKS.md',
            source_sha: null,
            evidence_label: 'reported_complete',
          },
        ],
        omitted_count: 0,
        note: 'Reported complete; no functional proof record.',
      },
      blockers: {
        status: 'available',
        provenance: 'reported',
        items: [
          {
            id: 't3',
            slug: 'task-three',
            title: 'Third task',
            description: 'stuck',
            status: 'blocked',
            sprint_label: 'Sprint 1',
            phase_title: 'Phase A',
            updated_at: '2026-09-01T09:30:00.000Z',
            completed_at: null,
            source_path: 'TASKS.md',
            source_sha: null,
            evidence_label: 'reported_blocked',
          },
        ],
        omitted_count: 0,
        note: 'Reported blocked.',
      },
      latest_changes: {
        status: 'available',
        provenance: 'verified_at_source',
        items: [
          {
            id: 'c1',
            kind: 'git_commit',
            title: 'Do a thing',
            summary: 'Git source abc12345 · complete.',
            occurred_at: '2026-09-01T09:45:00.000Z',
            provenance: 'verified_at_source',
            source_sha: 'abc12345'.padEnd(40, '0'),
          },
        ],
        omitted_count: 0,
        note: 'Persisted Git records.',
      },
      screenshots: {
        status: 'unknown',
        provenance: 'unknown',
        items: [],
        total: 0,
        omitted_count: 0,
        note: 'No visual evidence.',
      },
    },
    tasks: {
      status_counts: {
        planned: 1,
        in_progress: 1,
        blocked: 1,
        completed: 1,
        skipped: 0,
      },
      total: 4,
      items: [],
      omitted_count: 0,
    },
    resume_action: {
      type: 'task',
      label: 'Resume: Second task',
      task_id: 't1',
      rule: 'in_progress_first',
      provenance: 'verified_at_source',
    },
    evidence_gaps: [
      {
        code: 'functional_proof_not_recorded',
        section: 'what_works',
        message: 'Task completion is reported status, not proof.',
      },
    ],
    coverage: {
      accepted_memories: 2,
      selected_memories: 2,
      tracked_tasks: 4,
      selected_tasks: 4,
      meaningful_changes: 1,
      selected_changes: 1,
      visual_evidence: 'missing',
    },
    ...overrides,
  };
}

function adapterWith(handler, options = {}) {
  return new LabosMemcpAdapter({
    baseUrl: BASE,
    timeoutMs: 50,
    fetchImpl: handler,
    ...options,
  });
}

// --- URL validation ----------------------------------------------------------

test('only a numeric loopback HTTP address is accepted', () => {
  assert.ok(validateMemcpUrl('http://127.0.0.1:3210'));
  assert.ok(validateMemcpUrl('http://127.0.0.1:3211'));
  assert.ok(validateMemcpUrl('http://localhost:3210'));

  for (const bad of [
    'https://127.0.0.1:3210',
    'http://example.com:3210',
    'http://10.0.0.5:3210',
    'http://user:pass@127.0.0.1:3210',
    'http://127.0.0.1:3210/?a=1',
    'http://127.0.0.1:3210/#frag',
    'http://127.0.0.1:3210/api',
    'not a url',
    'file:///etc/passwd',
  ]) {
    assert.throws(
      () => validateMemcpUrl(bad),
      LabosMemcpError,
      `must be refused: ${bad}`
    );
  }
});

test('constructing with a remote address fails loudly', () => {
  assert.throws(
    () => new LabosMemcpAdapter({ baseUrl: 'http://evil.example:3210' }),
    LabosMemcpError
  );
});

// --- health -------------------------------------------------------------------

test('health reports the service as connected on success', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse({
      status: 'ok',
      archivist: 'mock-archivist',
      archivist_enabled: true,
      queue: 'running',
      recovery_mode: false,
      projection_writes_enabled: false,
    })
  );

  const health = await adapter.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.queue, 'running');
  const connection = adapter.connection();
  assert.equal(connection.connected, true);
  assert.ok(connection.lastReceivedAt, 'last received must be recorded');
  assert.equal(connection.lastError, null);
});

test('an unreachable service is reported as disconnected, not as an empty result', async () => {
  const adapter = adapterWith(async () => {
    throw new Error('ECONNREFUSED');
  });

  await assert.rejects(() => adapter.health(), LabosMemcpError);
  const connection = adapter.connection();
  assert.equal(connection.connected, false);
  assert.equal(connection.lastError?.code, 'unavailable');
  assert.equal(connection.lastReceivedAt, null, 'nothing was ever received');
});

// --- timeout ------------------------------------------------------------------

test('a timeout is reported as a timeout, not as unavailability', async () => {
  const adapter = adapterWith(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        // Abort exactly as fetch would when the signal fires.
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    { timeoutMs: 20 }
  );

  await assert.rejects(
    () => adapter.health(),
    (error) => {
      assert.ok(error instanceof LabosMemcpError);
      assert.equal(error.code, 'timeout');
      return true;
    }
  );
  assert.equal(adapter.connection().lastError?.code, 'timeout');
});

// --- redirects ----------------------------------------------------------------

test('a redirect is refused rather than followed', async () => {
  const adapter = adapterWith(async () =>
    new Response(null, { status: 302, headers: { location: 'http://evil.example/' } })
  );

  await assert.rejects(
    () => adapter.health(),
    (error) => {
      assert.equal(error.code, 'redirect-rejected');
      return true;
    }
  );
});

test('the adapter always asks fetch not to follow redirects', async () => {
  let seenRedirect;
  const adapter = adapterWith(async (_url, init) => {
    seenRedirect = init?.redirect;
    return jsonResponse({ status: 'ok' });
  });

  await adapter.health();
  assert.equal(seenRedirect, 'manual');
});

// --- malformed and oversized responses ---------------------------------------

test('a non-JSON response is refused', async () => {
  const adapter = adapterWith(
    async () => new Response('not json', { headers: { 'content-type': 'text/plain' } })
  );
  await assert.rejects(
    () => adapter.health(),
    (error) => {
      assert.equal(error.code, 'invalid-response');
      return true;
    }
  );
});

test('malformed JSON is refused rather than partially parsed', async () => {
  const adapter = adapterWith(
    async () =>
      new Response('{ this is not json', {
        headers: { 'content-type': 'application/json' },
      })
  );
  await assert.rejects(
    () => adapter.health(),
    (error) => {
      assert.equal(error.code, 'invalid-response');
      return true;
    }
  );
});

test('an oversized response is refused rather than truncated', async () => {
  const huge = 'x'.repeat(3 * 1024 * 1024);
  const adapter = adapterWith(
    async () =>
      new Response(JSON.stringify({ status: 'ok', pad: huge }), {
        headers: { 'content-type': 'application/json' },
      })
  );
  await assert.rejects(
    () => adapter.health(),
    (error) => {
      assert.equal(error.code, 'response-too-large');
      return true;
    }
  );
});

test('a 404 is reported as not-found, distinct from a failure', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse({ error: 'not found' }, { status: 404 })
  );
  await assert.rejects(
    () => adapter.getProjectSnapshot('missing-project'),
    (error) => {
      assert.equal(error.code, 'not-found');
      return true;
    }
  );
});

test('a 500 is reported as rejected, not as a parse failure', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse({ error: 'boom' }, { status: 500 })
  );
  await assert.rejects(
    () => adapter.listProjects(),
    (error) => {
      assert.equal(error.code, 'rejected');
      return true;
    }
  );
});

// --- the project list ---------------------------------------------------------

test('listing projects preserves absent fields as absent', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse({
      projects: [
        {
          id: 'p1',
          name: 'With Repo',
          slug: 'with-repo',
          status: 'active',
          category: null,
          summary: null,
          preview_url: null,
          cover_preview_id: null,
          repo_path: '/somewhere',
          repo_remote: 'https://example.invalid/repo.git',
          updated_at: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Without Repo',
          slug: 'without-repo',
          status: null,
          category: null,
          summary: null,
          preview_url: null,
          cover_preview_id: null,
          repo_path: null,
          repo_remote: null,
          updated_at: '2026-09-01T00:00:00.000Z',
        },
      ],
    })
  );

  const projects = await adapter.listProjects();
  assert.equal(projects.length, 2);

  assert.equal(projects[0].status, 'active');
  assert.equal(projects[0].hasRepository, true);

  // A null status must stay null. Defaulting it to "active" would be a
  // fabricated status, which is exactly what the brief forbids.
  assert.equal(projects[1].status, null);
  assert.equal(projects[1].hasRepository, false);
  assert.equal(projects[1].summary, null);
});

test('a project without a slug is dropped rather than shown unaddressable', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse({ projects: [{ id: 'p1', name: 'No slug' }] })
  );
  const projects = await adapter.listProjects();
  assert.deepEqual(projects, []);
});

test('a malformed project list does not throw', async () => {
  const adapter = adapterWith(async () => jsonResponse({ projects: 'nonsense' }));
  const projects = await adapter.listProjects();
  assert.deepEqual(projects, []);
});

// --- snapshots and conditional reads -----------------------------------------

test('a snapshot is returned and cached with its ETag', async () => {
  const snapshot = syntheticSnapshot();
  const adapter = adapterWith(async () =>
    jsonResponse(snapshot, { etag: '"fingerprint-one"' })
  );

  const result = await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(result.kind, 'changed');
  assert.equal(result.snapshot.project.slug, 'synthetic-project');
  assert.equal(adapter.hasCachedSnapshot('synthetic-project'), true);
});

test('a conditional request sends If-None-Match from the cached ETag', async () => {
  const snapshot = syntheticSnapshot();
  const seen = [];
  const adapter = adapterWith(async (_url, init) => {
    seen.push(init?.headers?.['if-none-match']);
    return jsonResponse(snapshot, { etag: '"fingerprint-one"' });
  });

  await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(seen[0], undefined, 'the first read is unconditional');

  await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(
    seen[1],
    '"fingerprint-one"',
    'the second read must use the stored ETag'
  );
});

test('a 304 returns the cached snapshot and is NOT treated as an error', async () => {
  // This is the specific trap the briefing warned about: the inspected generic
  // client rejected every 3xx, so a conditional request path had to handle 304
  // explicitly rather than parsing an empty body.
  const snapshot = syntheticSnapshot();
  let callCount = 0;
  const adapter = adapterWith(async () => {
    callCount += 1;
    if (callCount === 1) {
      return jsonResponse(snapshot, { etag: '"fingerprint-one"' });
    }
    return new Response(null, { status: 304, headers: { etag: '"fingerprint-one"' } });
  });

  const first = await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(first.kind, 'changed');

  const second = await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(
    second.kind,
    'not-modified',
    'an unchanged snapshot is reported as unchanged'
  );
  assert.equal(second.snapshot.project.slug, 'synthetic-project');
  // And critically: the connection is still healthy, not failed.
  assert.equal(adapter.connection().connected, true);
  assert.equal(adapter.connection().lastError, null);
});

test('a 304 with no cached snapshot is a protocol error, not a fabricated result', async () => {
  const adapter = adapterWith(
    async () => new Response(null, { status: 304 })
  );
  await assert.rejects(
    () => adapter.getProjectSnapshot('synthetic-project'),
    (error) => {
      assert.equal(error.code, 'invalid-response');
      return true;
    }
  );
});

test('force bypasses the cache and re-reads', async () => {
  const snapshot = syntheticSnapshot();
  const seen = [];
  const adapter = adapterWith(async (_url, init) => {
    seen.push(init?.headers?.['if-none-match']);
    return jsonResponse(snapshot, { etag: '"fingerprint-one"' });
  });

  await adapter.getProjectSnapshot('synthetic-project');
  await adapter.getProjectSnapshot('synthetic-project', { force: true });
  assert.equal(seen[1], undefined, 'a forced read must not be conditional');
});

// --- stale data ---------------------------------------------------------------

test('cached data survives a later failure but is marked stale', async () => {
  const snapshot = syntheticSnapshot();
  let fail = false;
  const adapter = adapterWith(async () => {
    if (fail) throw new Error('service went away');
    return jsonResponse(snapshot, { etag: '"fingerprint-one"' });
  });

  await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(adapter.connection().connected, true);

  fail = true;
  await assert.rejects(() => adapter.getProjectSnapshot('synthetic-project'));

  // The UI must be able to show the last-known data WITH its age, rather than
  // either hiding it or implying it is current.
  const cached = adapter.cachedSnapshot('synthetic-project');
  assert.ok(cached, 'the cached snapshot is still available');
  assert.equal(cached.project.slug, 'synthetic-project');
  assert.equal(adapter.connection().connected, false, 'but we are not connected');
  assert.ok(
    adapter.connection().lastReceivedAt,
    'and the age is still knowable'
  );
});

test('cached age is reported in milliseconds against the injected clock', async () => {
  let now = 1_000_000;
  const adapter = adapterWith(
    async () => jsonResponse(syntheticSnapshot(), { etag: '"e"' }),
    { now: () => now }
  );

  assert.equal(adapter.cachedAgeMs(), null, 'nothing received yet');

  await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(adapter.cachedAgeMs(), 0);

  now += 5_000;
  assert.equal(
    adapter.cachedAgeMs(),
    5_000,
    'the age must be measurable so the UI can say how old the data is'
  );
});

test('recovering after a failure clears the error and reconnects', async () => {
  let fail = true;
  const adapter = adapterWith(async () => {
    if (fail) throw new Error('down');
    return jsonResponse({ status: 'ok' });
  });

  await assert.rejects(() => adapter.health());
  assert.equal(adapter.connection().connected, false);

  fail = false;
  await adapter.health();
  assert.equal(adapter.connection().connected, true);
  assert.equal(adapter.connection().lastError, null);
});

// --- evidence fidelity --------------------------------------------------------

test('reported status is preserved as reported, never upgraded to verified', async () => {
  const snapshot = syntheticSnapshot();
  const adapter = adapterWith(async () =>
    jsonResponse(snapshot, { etag: '"e"' })
  );

  const result = await adapter.getProjectSnapshot('synthetic-project');
  const completed = result.snapshot.sections.what_works.items[0];

  assert.equal(
    completed.status,
    'completed',
    'the reported status is carried through'
  );
  assert.equal(
    completed.evidence_label,
    'reported_complete',
    'but it is labelled as REPORTED, not as verified proof'
  );
  assert.equal(
    result.snapshot.sections.what_works.provenance,
    'reported',
    'the section provenance must survive too'
  );
  assert.equal(
    result.snapshot.sections.what_works.status,
    'available',
    'including whether the section could be populated at all'
  );
});

test('a section that is unknown stays unknown rather than looking empty-but-fine', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse(syntheticSnapshot(), { etag: '"e"' })
  );
  const result = await adapter.getProjectSnapshot('synthetic-project');
  assert.equal(result.snapshot.sections.current_state.status, 'unknown');
  assert.equal(result.snapshot.sections.current_state.provenance, 'unknown');
});

test('evidence gaps are carried through so the UI can state what is missing', async () => {
  const adapter = adapterWith(async () =>
    jsonResponse(syntheticSnapshot(), { etag: '"e"' })
  );
  const result = await adapter.getProjectSnapshot('synthetic-project');
  const codes = result.snapshot.evidence_gaps.map(gap => gap.code);
  assert.ok(
    codes.includes('functional_proof_not_recorded'),
    'a missing proof must be surfaced, not hidden'
  );
});

test('an invalid slug is refused before any request is made', async () => {
  let called = false;
  const adapter = adapterWith(async () => {
    called = true;
    return jsonResponse({});
  });

  for (const slug of ['Not-A-Slug', 'has_underscore', 'UPPER', '../escape']) {
    await assert.rejects(() => adapter.getProjectSnapshot(slug), LabosMemcpError);
  }
  assert.equal(called, false, 'no request may be made for an invalid slug');
});
