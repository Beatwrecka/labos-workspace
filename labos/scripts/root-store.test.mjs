/**
 * LabOS Workspace — trusted root store tests.
 *
 * Run with: node --test labos/scripts/root-store.test.mjs
 *
 * The store reads a JSON file that sits on the user's own disk, so it is treated
 * as untrusted input: a corrupt or hand-edited file must degrade to "no roots"
 * rather than register something unexpected or crash startup.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);

async function loadStore() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/apps/electron/src/main/labos/root-store.ts'
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

const storeModule = await loadStore();

let userDataDir;

before(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-rootstore-'));
});

afterEach(async () => {
  await fs.rm(path.join(userDataDir, 'labos-trusted-roots.json'), {
    force: true,
  });
});

const newStore = () => new storeModule.LabosRootStore(() => userDataDir);

const filePath = () =>
  path.join(userDataDir, 'labos-trusted-roots.json');

test('an absent file means no roots, not an error', async () => {
  assert.deepEqual(await newStore().load(), []);
});

test('a root round-trips through add and load', async () => {
  const store = newStore();
  await store.add({ id: 'r1', label: 'Repo', absolutePath: '/tmp/some-repo' });

  const loaded = await store.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'r1');
  assert.equal(loaded[0].label, 'Repo');
  assert.equal(loaded[0].absolutePath, '/tmp/some-repo');
});

test('adding the same id replaces rather than duplicates', async () => {
  const store = newStore();
  await store.add({ id: 'r1', label: 'First', absolutePath: '/tmp/a' });
  await store.add({ id: 'r1', label: 'Second', absolutePath: '/tmp/b' });
  const loaded = await store.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].label, 'Second');
});

test('remove deletes only the named root', async () => {
  const store = newStore();
  await store.add({ id: 'r1', label: 'A', absolutePath: '/tmp/a' });
  await store.add({ id: 'r2', label: 'B', absolutePath: '/tmp/b' });
  await store.remove('r1');
  const loaded = await store.load();
  assert.deepEqual(loaded.map(r => r.id), ['r2']);
});

test('markUnavailable records the time without dropping the root', async () => {
  const store = newStore();
  await store.add({ id: 'r1', label: 'A', absolutePath: '/tmp/a' });
  await store.markUnavailable('r1');
  const loaded = await store.load();
  assert.equal(loaded.length, 1, 'an unavailable root is kept for the user to fix');
  assert.equal(typeof loaded[0].unavailableAt, 'string');
});

test('the file is written owner-only', async () => {
  const store = newStore();
  await store.add({ id: 'r1', label: 'A', absolutePath: '/tmp/a' });
  const stats = await fs.stat(filePath());
  // This file names directories on the user's machine.
  assert.equal(stats.mode & 0o777, 0o600);
});

// --- untrusted input ---------------------------------------------------------

test('malformed JSON degrades to no roots instead of throwing', async () => {
  await fs.writeFile(filePath(), '{ this is not json');
  assert.deepEqual(await newStore().load(), []);
});

test('a wrong schema version is refused', async () => {
  await fs.writeFile(
    filePath(),
    JSON.stringify({ version: 99, roots: [{ id: 'x', label: 'x', absolutePath: '/tmp/x' }] })
  );
  assert.deepEqual(await newStore().load(), []);
});

test('entries missing required fields are skipped, valid ones survive', async () => {
  await fs.writeFile(
    filePath(),
    JSON.stringify({
      version: 1,
      roots: [
        { id: 'good', label: 'Good', absolutePath: '/tmp/good' },
        { id: '', label: 'No id', absolutePath: '/tmp/bad' },
        { label: 'No id field', absolutePath: '/tmp/bad' },
        { id: 'relative', label: 'Relative', absolutePath: 'not/absolute' },
        { id: 'no-path', label: 'No path' },
        'not an object',
        null,
      ],
    })
  );

  const loaded = await newStore().load();
  assert.deepEqual(
    loaded.map(r => r.id),
    ['good'],
    'only well-formed absolute entries may be restored'
  );
});

test('a relative path is refused, since it cannot be resolved safely', async () => {
  await fs.writeFile(
    filePath(),
    JSON.stringify({
      version: 1,
      roots: [{ id: 'r', label: 'R', absolutePath: '../../etc' }],
    })
  );
  assert.deepEqual(await newStore().load(), []);
});

test('a non-object file is refused', async () => {
  await fs.writeFile(filePath(), JSON.stringify(['not', 'an', 'object']));
  assert.deepEqual(await newStore().load(), []);
});
