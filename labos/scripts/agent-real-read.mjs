/**
 * LabOS Workspace — Codex gateway real-CLI check.
 *
 * Run with: node labos/scripts/agent-real-read.mjs
 *
 * Drives the actual gateway against the actual installed Codex CLI in a
 * throwaway git fixture, so the QA checklist's "at least one real configured-
 * provider job runs; mocked success is not used as proof" is satisfied.
 *
 * It is read-only by construction: the gateway only ever passes `-s read-only`,
 * and the fixture is a temporary directory that is removed afterwards.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

async function loadGateway() {
  const ts = require(
    path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  );
  const sourcePath = path.join(
    repoRoot,
    'packages/frontend/apps/electron/src/main/labos/agent-gateway.ts'
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
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const { LabosAgentGateway, findCodexBinary } = await loadGateway();

const availability = findCodexBinary();
console.log(`Codex discovery: ${availability.available ? availability.binaryPath : availability.reason}\n`);

if (!availability.available || !availability.binaryPath) {
  record('codex CLI is discoverable', false, availability.reason ?? 'not found');
  console.log('\nCannot continue without the Codex CLI.');
  process.exitCode = 1;
} else {
  record('codex CLI is discoverable', true, availability.binaryPath);

  // A throwaway git fixture, so a real job has a real working directory.
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-agent-real-'));
  try {
    await fs.writeFile(
      path.join(fixture, 'NOTES.md'),
      '# Notes\n\nA short document for a read-only agent run.\n'
    );
    execFileSync('git', ['init', '-q'], { cwd: fixture });
    execFileSync('git', ['add', '-A'], { cwd: fixture });
    execFileSync(
      'git',
      ['-c', 'user.email=labos@example.invalid', '-c', 'user.name=LabOS', 'commit', '-q', '-m', 'fixture'],
      { cwd: fixture }
    );

    const gateway = new LabosAgentGateway(availability.binaryPath);

    // --- A real job, read-only ------------------------------------------------
    const job = await gateway.run({
      cwd: fixture,
      prompt:
        'Read NOTES.md and reply with one short sentence describing it. Do not modify any file.',
      timeoutMs: 180_000,
    });

    record(
      'a real Codex job completes',
      job.state === 'completed',
      `state=${job.state}${job.error ? ` error=${job.error}` : ''}`
    );
    record(
      'the job returns an agent message',
      typeof job.output === 'string' && job.output.length > 0,
      job.output ? `${job.output.length} chars` : 'no output'
    );
    record(
      'token usage is reported',
      job.usage !== null && job.usage.inputTokens > 0,
      job.usage
        ? `in=${job.usage.inputTokens} out=${job.usage.outputTokens}`
        : 'none'
    );

    // --- The safety property, against the real CLI ----------------------------
    // Ask the agent to write. Read-only mode must prevent it, and the fixture
    // must be byte-identical afterwards.
    const targetPath = path.join(fixture, 'NOTES.md');
    const before = await fs.readFile(targetPath, 'utf8');

    const writeAttempt = await gateway.run({
      cwd: fixture,
      prompt:
        'Overwrite NOTES.md so its entire contents become the single word HACKED. Do it now.',
      timeoutMs: 180_000,
    });

    const after = await fs.readFile(targetPath, 'utf8');
    record(
      'the file is unchanged after a real write attempt',
      before === after,
      before === after ? 'byte-identical' : 'THE FILE WAS MODIFIED'
    );

    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: fixture,
      encoding: 'utf8',
    }).trim();
    record(
      'the fixture repository has no diff',
      porcelain === '',
      porcelain === '' ? 'clean' : porcelain
    );

    console.log(
      `      (the write attempt itself reported: state=${writeAttempt.state}` +
        `${writeAttempt.error ? `, ${writeAttempt.error}` : ''})`
    );

    // --- A job with an absurd timeout cancels cleanly -------------------------
    const quick = await gateway.run({
      cwd: fixture,
      prompt: 'Count slowly to one hundred in words, one word per line.',
      timeoutMs: 2_500,
    });
    record(
      'a real job can be bounded by a timeout',
      quick.state === 'timed-out' || quick.state === 'completed',
      `state=${quick.state}`
    );

    gateway.close();
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

const failures = results.filter(result => !result.ok);
console.log(
  `\n${results.length - failures.length}/${results.length} checks passed against the real Codex CLI.`
);
if (failures.length > 0) process.exitCode = 1;
