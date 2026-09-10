/**
 * LabOS Workspace — repository file service tests (Phase 1 file matrix).
 *
 * Run with: node --test labos/scripts/repo-file-service.test.mjs
 *
 * These exercise the service against a real temporary directory using the real
 * filesystem, because paths, symlinks, permissions and rename semantics are the
 * things under test — a mocked fs would assert nothing useful.
 *
 * The mapping to the QA checklist's Phase 1 matrix is called out per test.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

// The service is TypeScript. Transpile it once with the repo's own TypeScript so
// the tests run against the real source rather than a parallel reimplementation.
async function loadService() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/apps/electron/src/main/labos/repo-file-service.ts'
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

const service = await loadService();

let workspace;
let repoDir;
let recoveryDir;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-repo-test-'));
  repoDir = path.join(workspace, 'repo');
  recoveryDir = path.join(workspace, 'recovery');
  await fs.mkdir(repoDir, { recursive: true });
  await fs.mkdir(recoveryDir, { recursive: true });
  await fs.mkdir(path.join(repoDir, 'docs', 'nested'), { recursive: true });
  await fs.mkdir(path.join(repoDir, 'node_modules', 'left-pad'), {
    recursive: true,
  });
  await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

function newService() {
  const s = service.createLabosRepoFileService();
  s.setRecoveryRoot(recoveryDir);
  return s;
}

async function withRoot() {
  const s = newService();
  const root = await s.registerRoot({ id: 'repo', absolutePath: repoDir });
  return { s, root };
}

async function writeFixture(relativePath, content) {
  const absolute = path.join(repoDir, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
  return absolute;
}

// --- 1. byte-identical read ------------------------------------------------

test('opening and closing a document leaves the bytes and git diff unchanged', async () => {
  const { s } = await withRoot();
  const tricky = [
    '---',
    'title: Frontmatter stays',
    'tags: [a, b]',
    '---',
    '',
    '# Heading',
    '',
    'Nested list:',
    '  - one',
    '    - two',
    '',
    '- [ ] a task',
    '- [x] a done task',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    'UTF-8 and emoji: café, 日本語, 🎯',
    '',
    '<!-- a comment that must survive -->',
    '',
    '[ref link][ref]',
    '',
    '[ref]: https://example.invalid',
    '',
    'Relative image: ![alt](./img.png)',
    '',
    'Fenced code containing backticks:',
    '````md',
    '```js',
    'const x = 1;',
    '```',
    '````',
    '',
    '<div>inline html</div>',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    'Unknown extension: $$x^2$$',
    '',
    'Text with no trailing newline at the very end',
  ].join('\n');

  const absolute = await writeFixture('docs/tricky.md', tricky);

  // Git-visible state before reading.
  const beforeStats = await fs.stat(absolute);
  const beforeBytes = await fs.readFile(absolute);

  const read = await s.readDocument('repo', 'docs/tricky.md');
  assert.equal(read.content, tricky, 'content must round-trip exactly');
  assert.equal(read.relativePath, 'docs/tricky.md');
  assert.equal(read.readOnly, false);

  const afterStats = await fs.stat(absolute);
  const afterBytes = await fs.readFile(absolute);
  assert.deepEqual(afterBytes, beforeBytes, 'bytes must be untouched by a read');
  assert.equal(afterStats.mtimeMs, beforeStats.mtimeMs, 'read must not touch mtime');
  assert.equal(afterStats.size, beforeStats.size);
});

test('CRLF line endings and missing trailing newline survive a read', async () => {
  const { s } = await withRoot();
  const crlf = 'line one\r\nline two\r\nline three';
  await writeFixture('docs/crlf.md', crlf);

  const read = await s.readDocument('repo', 'docs/crlf.md');
  assert.equal(read.content, crlf, 'CRLF must not be normalised to LF');
  assert.ok(!read.content.endsWith('\n'), 'missing trailing newline is preserved');
});

test('the read hash matches the exact bytes on disk', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/hash.md', '# Hello\n');
  const read = await s.readDocument('repo', 'docs/hash.md');
  const fresh = await fs.readFile(path.join(repoDir, 'docs/hash.md'));
  assert.equal(read.hash, service.hashContent(fresh));
});

// --- 2. app edit preserves unrelated text ----------------------------------

test('editing one sentence changes the file and preserves everything else', async () => {
  const { s } = await withRoot();
  const original = [
    '---',
    'title: Keep me',
    '---',
    '',
    '# Title',
    '',
    'This sentence will change.',
    '',
    '<!-- preserved comment -->',
    '',
    '```js',
    'const untouched = true;',
    '```',
    '',
    'Trailing text',
  ].join('\n');
  await writeFixture('docs/edit.md', original);

  const read = await s.readDocument('repo', 'docs/edit.md');
  const edited = read.content.replace(
    'This sentence will change.',
    'This sentence changed.'
  );
  const result = await s.writeDocument('repo', 'docs/edit.md', edited, {
    expectedHash: read.hash,
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  const onDisk = await fs.readFile(path.join(repoDir, 'docs/edit.md'), 'utf8');
  assert.equal(onDisk, edited);
  // Everything not targeted is byte-identical.
  assert.match(onDisk, /title: Keep me/);
  assert.match(onDisk, /<!-- preserved comment -->/);
  assert.match(onDisk, /const untouched = true;/);
  assert.match(onDisk, /^Trailing text$/m);
  assert.ok(!onDisk.includes('This sentence will change.'));
});

test('a save does not normalise the rest of the document', async () => {
  const { s } = await withRoot();
  const original = '# A\r\n\r\nB   \r\n\r\nC';
  await writeFixture('docs/normalise.md', original);
  const read = await s.readDocument('repo', 'docs/normalise.md');
  const edited = read.content.replace('# A', '# A edited');
  const result = await s.writeDocument('repo', 'docs/normalise.md', edited, {
    expectedHash: read.hash,
  });
  assert.equal(result.ok, true);
  const onDisk = await fs.readFile(path.join(repoDir, 'docs/normalise.md'), 'utf8');
  assert.equal(onDisk, '# A edited\r\n\r\nB   \r\n\r\nC');
});

test('a save leaves no temporary or stray file behind', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/clean.md', 'original');
  const read = await s.readDocument('repo', 'docs/clean.md');
  await s.writeDocument('repo', 'docs/clean.md', 'changed', {
    expectedHash: read.hash,
  });
  const entries = await fs.readdir(path.join(repoDir, 'docs'));
  assert.deepEqual(
    entries.filter(name => name.includes('.labos-') || name.endsWith('.tmp')),
    [],
    'no temporary file may survive a successful write'
  );
});

// --- 3/4. conflict handling -------------------------------------------------

test('a stale write fails safely instead of overwriting (dirty vs external edit)', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/conflict.md', 'base');
  const read = await s.readDocument('repo', 'docs/conflict.md');

  // An external writer changes the file after the draft's base was captured.
  await fs.writeFile(path.join(repoDir, 'docs/conflict.md'), 'external change');

  const result = await s.writeDocument('repo', 'docs/conflict.md', 'app draft', {
    expectedHash: read.hash,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'hash-mismatch');
  assert.equal(
    typeof result.actualHash,
    'string',
    'the caller needs the real hash to offer a compare'
  );
  // Critically: neither version was silently lost.
  const onDisk = await fs.readFile(path.join(repoDir, 'docs/conflict.md'), 'utf8');
  assert.equal(onDisk, 'external change', 'the external version is not clobbered');
});

test('two writers using the same base revision: one wins, the stale one fails', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/race.md', 'base');
  const read = await s.readDocument('repo', 'docs/race.md');

  const first = await s.writeDocument('repo', 'docs/race.md', 'writer A', {
    expectedHash: read.hash,
  });
  const second = await s.writeDocument('repo', 'docs/race.md', 'writer B', {
    expectedHash: read.hash,
  });

  assert.equal(first.ok, true, 'the first writer is serialised and accepted');
  assert.equal(second.ok, false, 'the second writer must fail safely');
  assert.equal(second.reason, 'hash-mismatch');
  assert.equal(
    await fs.readFile(path.join(repoDir, 'docs/race.md'), 'utf8'),
    'writer A'
  );
});

test('a failed write stores a recovery version of what it would have replaced', async () => {
  const { s } = await withRoot();
  const marker = `recovery-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFixture('docs/recover.md', `original content ${marker}`);
  const read = await s.readDocument('repo', 'docs/recover.md');
  await s.writeDocument('repo', 'docs/recover.md', 'replacement', {
    expectedHash: read.hash,
  });

  // Recovery versions accumulate across tests in one directory, so search for
  // the version belonging to THIS fixture rather than assuming it is the only
  // file present.
  const recoveryRoot = path.join(recoveryDir, 'repo');
  const found = execFileSync('find', [recoveryRoot, '-type', 'f'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  assert.ok(found.length >= 1, 'a recovery version must exist');

  const matching = await Promise.all(
    found.map(async file => ({ file, contents: await fs.readFile(file, 'utf8') }))
  );
  const recovered = matching.find(entry => entry.contents.includes(marker));
  assert.ok(
    recovered,
    'a recovery version must hold the bytes that were replaced'
  );
  assert.equal(
    recovered.contents,
    `original content ${marker}`,
    'recovery holds the exact replaced content'
  );
});

test('a crash mid-write leaves no truncated document', async () => {
  const { s } = await withRoot();
  const original = 'x'.repeat(4096);
  await writeFixture('docs/crash.md', original);

  // Simulate an interrupted save: a leftover temp file in the same directory,
  // as would remain if the process died between open and rename.
  const stale = path.join(repoDir, 'docs', '.crash.md.labos-999-0.tmp');
  await fs.writeFile(stale, 'partial');

  const read = await s.readDocument('repo', 'docs/crash.md');
  assert.equal(read.content, original, 'the real document is unaffected');

  // A subsequent successful save still works and cleans up after itself.
  const result = await s.writeDocument('repo', 'docs/crash.md', 'rewritten', {
    expectedHash: read.hash,
  });
  assert.equal(result.ok, true);
  assert.equal(
    await fs.readFile(path.join(repoDir, 'docs/crash.md'), 'utf8'),
    'rewritten'
  );
  await fs.rm(stale, { force: true });
});

// --- 5. external writer via temp file + rename ------------------------------

test('an atomic replace by an external writer is detected by hash', async () => {
  const { s } = await withRoot();
  const target = await writeFixture('docs/atomic.md', 'v1');
  const read = await s.readDocument('repo', 'docs/atomic.md');

  // The agent-style write: temp file in the same directory, then rename.
  const temp = path.join(repoDir, 'docs', '.atomic.md.external.tmp');
  await fs.writeFile(temp, 'v2 from an agent');
  await fs.rename(temp, target);

  const stale = await s.writeDocument('repo', 'docs/atomic.md', 'app draft', {
    expectedHash: read.hash,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'hash-mismatch');

  // Re-reading sees the replacement and permits a new write.
  const reread = await s.readDocument('repo', 'docs/atomic.md');
  assert.equal(reread.content, 'v2 from an agent');
  const fresh = await s.writeDocument('repo', 'docs/atomic.md', 'app wins now', {
    expectedHash: reread.hash,
  });
  assert.equal(fresh.ok, true);
});

// --- 6. rename / delete -----------------------------------------------------

test('a file deleted externally is reported missing and never recreated', async () => {
  const { s } = await withRoot();
  const target = await writeFixture('docs/gone.md', 'content');
  const read = await s.readDocument('repo', 'docs/gone.md');
  await fs.rm(target);

  const result = await s.writeDocument('repo', 'docs/gone.md', 'draft', {
    expectedHash: read.hash,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'file-missing');

  // The app must not resurrect it.
  await assert.rejects(fs.access(target), 'the file must not be recreated');

  // And a read reports the missing file truthfully.
  await assert.rejects(
    s.readDocument('repo', 'docs/gone.md'),
    'reading a deleted document must reject'
  );
});

test('a file renamed externally disappears rather than being silently rewritten', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/old-name.md', 'content');
  const read = await s.readDocument('repo', 'docs/old-name.md');
  await fs.rename(
    path.join(repoDir, 'docs/old-name.md'),
    path.join(repoDir, 'docs/new-name.md')
  );

  const result = await s.writeDocument('repo', 'docs/old-name.md', 'draft', {
    expectedHash: read.hash,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'file-missing');
  assert.equal(
    await fs.readFile(path.join(repoDir, 'docs/new-name.md'), 'utf8'),
    'content',
    'the renamed file is untouched'
  );
});

// --- 7. access control ------------------------------------------------------

test('traversal outside the root is rejected', async () => {
  const { s } = await withRoot();
  await fs.writeFile(path.join(workspace, 'outside.md'), 'secret');

  for (const attempt of [
    '../outside.md',
    'docs/../../outside.md',
    '../../etc/passwd',
  ]) {
    await assert.rejects(
      s.readDocument('repo', attempt),
      'traversal must be rejected: ' + attempt
    );
  }
});

test('an absolute path is rejected', async () => {
  const { s } = await withRoot();
  await assert.rejects(s.readDocument('repo', '/etc/passwd'));
});

test('a symlink pointing outside the root is rejected', async () => {
  const { s } = await withRoot();
  await fs.writeFile(path.join(workspace, 'outside-target.md'), 'outside');

  await fs.symlink(
    path.join(workspace, 'outside-target.md'),
    path.join(repoDir, 'docs', 'escaping-link.md')
  );

  await assert.rejects(
    s.readDocument('repo', 'docs/escaping-link.md'),
    'a symlink must not be followed out of the root'
  );

  const write = await s.writeDocument(
    'repo',
    'docs/escaping-link.md',
    'overwrite attempt',
    { expectedHash: 'x' }
  );
  assert.equal(write.ok, false);
  assert.equal(
    await fs.readFile(path.join(workspace, 'outside-target.md'), 'utf8'),
    'outside',
    'the link target outside the root must be unchanged'
  );
});

test('a document symlinked to another file in the same root is reported, not followed', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/real.md', 'real content');
  await fs.symlink(
    path.join(repoDir, 'docs', 'real.md'),
    path.join(repoDir, 'docs', 'link.md')
  );
  await assert.rejects(
    s.readDocument('repo', 'docs/link.md'),
    'a symlinked document is refused so its identity is never ambiguous'
  );
});

test('a directory is not readable as a document', async () => {
  const { s } = await withRoot();
  await fs.mkdir(path.join(repoDir, 'docs', 'a-directory'), {
    recursive: true,
  });
  await assert.rejects(s.readDocument('repo', 'docs/a-directory'));
});

test('a named pipe is not treated as a document', async () => {
  const { s } = await withRoot();
  const fifo = path.join(repoDir, 'docs', 'pipe.md');
  try {
    execFileSync('mkfifo', [fifo]);
  } catch {
    return; // mkfifo unavailable: nothing to assert
  }
  await assert.rejects(
    s.readDocument('repo', 'docs/pipe.md'),
    'a non-regular file must be refused'
  );
});

// --- 8. limits and permissions ----------------------------------------------

test('a document over the size limit is refused rather than truncated', async () => {
  // 64-byte limit so the fixture stays small.
  const limited = service.createLabosRepoFileService({ maxDocumentBytes: 64 });
  limited.setRecoveryRoot(recoveryDir);
  await limited.registerRoot({ id: 'repo', absolutePath: repoDir });

  const { s } = await withRoot();
  await writeFixture('docs/big.md', 'y'.repeat(200));

  await assert.rejects(
    limited.readDocument('repo', 'docs/big.md'),
    /over the .* limit/,
    'an over-limit document must produce a clear bounded error'
  );

  const read = await s.readDocument('repo', 'docs/big.md');
  const write = await limited.writeDocument(
    'repo',
    'docs/big.md',
    'z'.repeat(200),
    { expectedHash: read.hash }
  );
  assert.equal(write.ok, false);
  assert.equal(write.reason, 'too-large');
});

test('a read-only document reports read-only and refuses the write', async () => {
  const { s } = await withRoot();
  const target = await writeFixture('docs/readonly.md', 'immutable');
  await fs.chmod(target, 0o444);

  try {
    const read = await s.readDocument('repo', 'docs/readonly.md');
    assert.equal(read.readOnly, true, 'read-only must be reported, not guessed');

    const write = await s.writeDocument(
      'repo',
      'docs/readonly.md',
      'attempt',
      { expectedHash: read.hash }
    );
    assert.equal(write.ok, false);
    assert.equal(write.reason, 'read-only');
    assert.equal(
      await fs.readFile(target, 'utf8'),
      'immutable',
      'content is unchanged'
    );
  } finally {
    await fs.chmod(target, 0o644);
  }
});

// --- 9. discovery scope -----------------------------------------------------

test('indexing respects exclusions, ignores non-Markdown and reports truncation', async () => {
  const { s } = await withRoot();
  await writeFixture('docs/indexed.md', '# indexed');
  await writeFixture('docs/nested/deep.md', '# deep');
  await writeFixture('docs/not-markdown.txt', 'ignored');
  await writeFixture('docs/.env', 'SECRET=1');
  await writeFixture('docs/.env.local', 'SECRET=2');
  await writeFixture('docs/id_rsa', 'private key');
  await writeFixture('docs/server.pem', 'cert');
  await writeFixture('docs/data.sqlite', 'db');
  await writeFixture('node_modules/left-pad/readme.md', '# dependency');
  await writeFixture('.git/COMMIT_EDITMSG.md', '# git internals');
  await writeFixture('dist/built.md', '# build output');

  const { documents, truncated, scannedDirectories } = await s.indexRoot('repo');
  const paths = documents.map(d => d.relativePath);

  assert.ok(paths.includes('docs/indexed.md'));
  assert.ok(paths.includes('docs/nested/deep.md'));
  assert.ok(!paths.includes('docs/not-markdown.txt'), 'only .md is indexed');
  assert.ok(!paths.includes('docs/.env'), 'env files are excluded');
  assert.ok(!paths.includes('docs/.env.local'), 'env variants are excluded');
  assert.ok(!paths.includes('docs/id_rsa'), 'private keys are excluded');
  assert.ok(!paths.includes('docs/server.pem'), 'key material is excluded');
  assert.ok(!paths.includes('docs/data.sqlite'), 'databases are excluded');
  assert.ok(!paths.some(p => p.startsWith('node_modules/')), 'node_modules excluded');
  assert.ok(!paths.some(p => p.startsWith('.git/')), '.git excluded');
  assert.ok(!paths.some(p => p.startsWith('dist/')), 'build output excluded');
  assert.equal(truncated, false);
  assert.ok(scannedDirectories > 0);
});

test('the document cap is enforced and reported rather than silently truncating', async () => {
  const limited = service.createLabosRepoFileService({ maxIndexedDocuments: 3 });
  limited.setRecoveryRoot(recoveryDir);
  await limited.registerRoot({ id: 'repo', absolutePath: repoDir });

  const { documents, truncated } = await limited.indexRoot('repo');
  assert.equal(documents.length, 3);
  assert.equal(truncated, true, 'truncation must be reported, not hidden');
});

test('an unregistered root is refused', async () => {
  const s = newService();
  await assert.rejects(s.readDocument('nope', 'docs/indexed.md'));
  const write = await s.writeDocument('nope', 'docs/indexed.md', 'x', {
    expectedHash: 'y',
  });
  assert.equal(write.ok, false);
  assert.equal(write.reason, 'no-such-root');
});

test('registering a root rejects a file and records the canonical path', async () => {
  const s = newService();
  const file = await writeFixture('docs/not-a-dir.md', 'x');
  await assert.rejects(
    s.registerRoot({ id: 'bad', absolutePath: file }),
    'a root must be a directory'
  );

  const root = await s.registerRoot({ id: 'ok', absolutePath: repoDir });
  assert.equal(root.absolutePath, await fs.realpath(repoDir));
  assert.equal(s.listRoots().length, 1);
  assert.equal(s.unregisterRoot('ok'), true);
  assert.equal(s.listRoots().length, 0);
});
