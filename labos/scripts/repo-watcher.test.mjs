/**
 * LabOS Workspace — repository watcher tests.
 *
 * Run with: node --test labos/scripts/repo-watcher.test.mjs
 *
 * These drive a real filesystem watcher against a real temporary directory,
 * because the behaviours under test (atomic replacement, debounce, self-write
 * suppression) only exist in the interaction with the OS event stream.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

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
    },
    fileName: sourcePath,
  }).outputText;
  const dataUrl =
    'data:text/javascript;base64,' +
    Buffer.from(transpiled, 'utf8').toString('base64');
  return import(dataUrl);
}

const serviceModule = await loadModule(
  'packages/frontend/apps/electron/src/main/labos/repo-file-service.ts'
);
const watcherModule = await loadModule(
  'packages/frontend/apps/electron/src/main/labos/repo-watcher.ts'
);

let workspace;
let repoDir;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-watch-test-'));
  repoDir = path.join(workspace, 'repo');
  await fs.mkdir(path.join(repoDir, 'docs'), { recursive: true });
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A service plus watcher over the same directory, wired like production. */
async function harness({ debounceMs = 20 } = {}) {
  const service = serviceModule.createLabosRepoFileService();
  await service.registerRoot({ id: 'repo', absolutePath: repoDir });

  const changes = [];
  const watcher = new watcherModule.LabosRepoWatcher({
    debounceMs,
    resolveHash: async (rootId, relativePath) => {
      try {
        const read = await service.readDocument(rootId, relativePath);
        return read.hash;
      } catch {
        return null;
      }
    },
    onChange: change => changes.push(change),
  });
  watcher.watchRoot('repo', repoDir);

  return { service, watcher, changes };
}

// --- external edits ---------------------------------------------------------

test('an external edit to a clean file is reported once', async () => {
  const { service, watcher, changes } = await harness();
  const file = path.join(repoDir, 'docs', 'external.md');
  await fs.writeFile(file, 'v1');
  await service.readDocument('repo', 'docs/external.md');
  await delay(60);
  changes.length = 0;

  await fs.writeFile(file, 'v2 from an external editor');
  await delay(200);

  const relevant = changes.filter(c => c.relativePath === 'docs/external.md');
  assert.ok(relevant.length >= 1, 'the external edit must be reported');
  // Coalesced: one save must not produce a burst of notifications.
  assert.ok(
    relevant.length <= 2,
    `expected coalesced notifications, got ${relevant.length}`
  );
  assert.equal(
    relevant[relevant.length - 1].kind,
    'modified',
    'a content change to a known file is a modification'
  );
  watcher.close();
});

test('an agent write via temp file plus rename is detected', async () => {
  const { service, watcher, changes } = await harness();
  const target = path.join(repoDir, 'docs', 'agent.md');
  await fs.writeFile(target, 'v1');
  await service.readDocument('repo', 'docs/agent.md');
  await delay(60);
  changes.length = 0;

  // The pattern an agent uses: write a sibling temp file, then rename over.
  const temp = path.join(repoDir, 'docs', '.agent.md.tmp');
  await fs.writeFile(temp, 'v2 written by an agent');
  await fs.rename(temp, target);
  await delay(250);

  const relevant = changes.filter(c => c.relativePath === 'docs/agent.md');
  assert.ok(
    relevant.length >= 1,
    'atomic replacement must be detected, which is why the directory is watched'
  );
  const read = await service.readDocument('repo', 'docs/agent.md');
  assert.equal(read.content, 'v2 written by an agent');
  watcher.close();
});

test('a rapid save burst produces a bounded number of notifications', async () => {
  const { service, watcher, changes } = await harness({ debounceMs: 50 });
  const file = path.join(repoDir, 'docs', 'burst.md');
  await fs.writeFile(file, 'v0');
  await service.readDocument('repo', 'docs/burst.md');
  await delay(80);
  changes.length = 0;

  for (let i = 1; i <= 10; i += 1) {
    await fs.writeFile(file, `version ${i}`);
    await delay(5);
  }
  await delay(400);

  const relevant = changes.filter(c => c.relativePath === 'docs/burst.md');
  assert.ok(relevant.length >= 1, 'the burst must be noticed');
  assert.ok(
    relevant.length <= 3,
    `10 rapid writes must coalesce, got ${relevant.length} notifications`
  );
  watcher.close();
});

test('an external delete is reported and the file is not recreated', async () => {
  const { service, watcher, changes } = await harness();
  const file = path.join(repoDir, 'docs', 'vanishing.md');
  await fs.writeFile(file, 'here for now');
  await service.readDocument('repo', 'docs/vanishing.md');
  await delay(60);
  changes.length = 0;

  await fs.rm(file);
  await delay(250);

  const relevant = changes.filter(c => c.relativePath === 'docs/vanishing.md');
  assert.ok(relevant.length >= 1, 'the deletion must be reported');
  const last = relevant[relevant.length - 1];
  assert.equal(last.kind, 'deleted');
  assert.equal(last.hash, null, 'a deleted file has no content hash');
  await assert.rejects(
    fs.access(file),
    'the watcher must never recreate a deleted file'
  );
  watcher.close();
});

test('an external rename is observed as a delete of the old path', async () => {
  const { service, watcher, changes } = await harness();
  const from = path.join(repoDir, 'docs', 'before.md');
  const to = path.join(repoDir, 'docs', 'after.md');
  await fs.writeFile(from, 'content');
  await service.readDocument('repo', 'docs/before.md');
  await delay(60);
  changes.length = 0;

  await fs.rename(from, to);
  await delay(250);

  const oldPath = changes.filter(c => c.relativePath === 'docs/before.md');
  const newPath = changes.filter(c => c.relativePath === 'docs/after.md');
  assert.ok(
    oldPath.length >= 1 || newPath.length >= 1,
    'a rename must surface as a change on the old and/or new path'
  );
  assert.equal(
    await fs.readFile(to, 'utf8'),
    'content',
    'the renamed file is untouched'
  );
  watcher.close();
});

// --- self-write suppression --------------------------------------------------

test("the app's own save does not come back as an external change", async () => {
  const { service, watcher, changes } = await harness();
  const file = path.join(repoDir, 'docs', 'self-write.md');
  await fs.writeFile(file, 'base');
  const read = await service.readDocument('repo', 'docs/self-write.md');
  await delay(60);
  changes.length = 0;

  const result = await service.writeDocument(
    'repo',
    'docs/self-write.md',
    'written by the app',
    { expectedHash: read.hash }
  );
  assert.equal(result.ok, true);
  // Tell the watcher what we wrote, exactly as the IPC layer will.
  watcher.noteSelfWrite('repo', 'docs/self-write.md', result.hash);
  await delay(250);

  const relevant = changes.filter(c => c.relativePath === 'docs/self-write.md');
  assert.equal(
    relevant.length,
    0,
    'a self-generated write must not be reported as an external change, or the ' +
      'UI would show a spurious conflict immediately after every save'
  );
  watcher.close();
});

test('a genuine external change after a self-write is still reported', async () => {
  const { service, watcher, changes } = await harness();
  const file = path.join(repoDir, 'docs', 'after-self.md');
  await fs.writeFile(file, 'base');
  const read = await service.readDocument('repo', 'docs/after-self.md');

  const result = await service.writeDocument(
    'repo',
    'docs/after-self.md',
    'app write',
    { expectedHash: read.hash }
  );
  watcher.noteSelfWrite('repo', 'docs/after-self.md', result.hash);
  await delay(150);
  changes.length = 0;

  await fs.writeFile(file, 'someone else changed this');
  await delay(250);

  const relevant = changes.filter(c => c.relativePath === 'docs/after-self.md');
  assert.ok(
    relevant.length >= 1,
    'suppression must not swallow a subsequent real external change'
  );
  watcher.close();
});

// --- reconciliation ---------------------------------------------------------

test('reconcile detects a change the event stream missed', async () => {
  const { service, watcher } = await harness();
  const file = path.join(repoDir, 'docs', 'missed.md');
  await fs.writeFile(file, 'v1');
  const read = await service.readDocument('repo', 'docs/missed.md');
  watcher.noteSelfWrite('repo', 'docs/missed.md', read.hash);

  // Simulate a change that arrived while no event was delivered, as happens
  // across sleep/wake or a dropped notification.
  await fs.writeFile(file, 'changed while we were not listening');

  const change = await watcher.reconcile('repo', 'docs/missed.md');
  assert.ok(change, 'reconciliation must find the change the events missed');
  assert.equal(change.kind, 'modified');
  assert.notEqual(change.hash, read.hash);
  watcher.close();
});

test('reconcile reports nothing when the file is unchanged', async () => {
  const { service, watcher } = await harness();
  const file = path.join(repoDir, 'docs', 'stable.md');
  await fs.writeFile(file, 'unchanged');
  const read = await service.readDocument('repo', 'docs/stable.md');
  watcher.noteSelfWrite('repo', 'docs/stable.md', read.hash);

  const change = await watcher.reconcile('repo', 'docs/stable.md');
  assert.equal(change, null, 'an unchanged file must not report a change');
  watcher.close();
});

test('reconcile reports a file that vanished while unwatched', async () => {
  const { service, watcher } = await harness();
  const file = path.join(repoDir, 'docs', 'yanked.md');
  await fs.writeFile(file, 'here');
  const read = await service.readDocument('repo', 'docs/yanked.md');
  watcher.noteSelfWrite('repo', 'docs/yanked.md', read.hash);

  await fs.rm(file);
  const change = await watcher.reconcile('repo', 'docs/yanked.md');
  assert.ok(change);
  assert.equal(change.kind, 'deleted');
  assert.equal(change.hash, null);
  watcher.close();
});

// --- lifecycle ---------------------------------------------------------------

test('closing the watcher stops notifications and is idempotent', async () => {
  const { watcher, changes } = await harness();
  watcher.watchRoot('repo', repoDir);
  assert.deepEqual(watcher.watchedRootIds, ['repo']);

  watcher.close();
  assert.deepEqual(watcher.watchedRootIds, [], 'closing releases every root');
  watcher.close(); // must not throw

  const before = changes.length;
  await fs.writeFile(path.join(repoDir, 'docs', 'after-close.md'), 'ignored');
  await delay(200);
  assert.equal(changes.length, before, 'a closed watcher reports nothing');
});

test('watching the same root twice does not duplicate watchers', async () => {
  const { watcher } = await harness();
  watcher.watchRoot('repo', repoDir);
  watcher.watchRoot('repo', repoDir);
  assert.deepEqual(watcher.watchedRootIds, ['repo']);
  watcher.close();
});
