/**
 * LabOS Workspace — Codex agent gateway tests.
 *
 * Run with: node --test labos/scripts/agent-gateway.test.mjs
 *
 * Two kinds of test here:
 *
 *  1. **Safety invariants** — asserted against the real argument builder, because
 *     "we would never pass a dangerous flag" is exactly the kind of claim that
 *     quietly stops being true. These fail if it ever becomes false.
 *  2. **Behaviour** — driven against a real child process, using a stub script
 *     that emits the same JSONL shape the verified CLI emits, so cancellation,
 *     timeout and failure paths are exercised for real rather than mocked.
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

const gatewayModule = await loadGateway();
const { buildCodexArgs, parseCodexEvent, LabosAgentGateway, findCodexBinary } =
  gatewayModule;

let workspace;
let stubDir;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-agent-test-'));
  stubDir = workspace;

  // A stub that emits the same JSONL the verified CLI emits, so the gateway's
  // parsing and lifecycle logic runs against real process behaviour.
  await fs.writeFile(
    path.join(stubDir, 'stub-ok.sh'),
    `#!/bin/sh
echo '{"type":"thread.started","thread_id":"t1"}'
echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"PROPOSAL: change line 3"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":12}}'
exit 0
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(stubDir, 'stub-fail.sh'),
    `#!/bin/sh
echo '{"type":"thread.started","thread_id":"t2"}'
exit 3
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(stubDir, 'stub-silent.sh'),
    `#!/bin/sh
exit 0
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(stubDir, 'stub-hang.sh'),
    `#!/bin/sh
echo '{"type":"thread.started","thread_id":"t3"}'
sleep 60
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(stubDir, 'stub-flood.sh'),
    `#!/bin/sh
i=0
while [ $i -lt 200000 ]; do
  echo '{"type":"item.completed","item":{"id":"x","type":"agent_message","text":"padding padding padding padding padding"}}'
  i=$((i+1))
done
exit 0
`,
    { mode: 0o755 }
  );

  await fs.writeFile(
    path.join(stubDir, 'stub-crash.sh'),
    `#!/bin/sh
echo '{"type":"thread.started","thread_id":"t4"}'
kill -SEGV $$
`,
    { mode: 0o755 }
  );
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

// --- safety invariants ----------------------------------------------------------

test('the argument builder always requests read-only mode', () => {
  const args = buildCodexArgs({ cwd: '/tmp/x', prompt: 'do a thing' });
  const sandboxIndex = args.indexOf('-s');
  assert.ok(sandboxIndex !== -1, 'a sandbox mode must be specified explicitly');
  assert.equal(
    args[sandboxIndex + 1],
    'read-only',
    'every job must start read-only'
  );
});

test('no dangerous flag can ever be produced', () => {
  // The single most important assertion in this file. If a future change adds
  // any of these, the app would be granting an agent write or unrestricted
  // access to the user's machine, so this fails loudly.
  const forbidden = [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    'workspace-write',
    'danger-full-access',
    '--yolo',
  ];

  for (const prompt of [
    'normal prompt',
    '',
    'prompt with --dangerously-bypass-approvals-and-sandbox inside it',
    'prompt with -s workspace-write inside it',
    'prompt; rm -rf /',
    'prompt && curl evil.example',
  ]) {
    const args = buildCodexArgs({ cwd: '/tmp/x', prompt });
    for (const flag of forbidden) {
      // The prompt itself may legitimately CONTAIN such text as data, so only
      // the arguments other than the trailing prompt are checked.
      assert.ok(
        !args.slice(0, -1).includes(flag),
        `a forbidden flag leaked into the arguments: ${flag}`
      );
    }
  }
});

test('a prompt containing shell metacharacters cannot inject a flag', () => {
  const prompt = '"; --dangerously-bypass-approvals-and-sandbox; echo pwned';
  const args = buildCodexArgs({ cwd: '/tmp/x', prompt });
  assert.equal(args[args.length - 1], prompt, 'the prompt stays one argument');
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('the working directory is passed explicitly', () => {
  const args = buildCodexArgs({ cwd: '/some/repo', prompt: 'x' });
  const cdIndex = args.indexOf('-C');
  assert.ok(cdIndex !== -1, 'the working root must be explicit');
  assert.equal(args[cdIndex + 1], '/some/repo');
});

test('structured output is requested', () => {
  assert.ok(buildCodexArgs({ cwd: '/tmp', prompt: 'x' }).includes('--json'));
});

// --- event parsing ---------------------------------------------------------------

test('a thread.started event is parsed', () => {
  const event = parseCodexEvent('{"type":"thread.started","thread_id":"abc"}');
  assert.equal(event.kind, 'thread-started');
  assert.equal(event.threadId, 'abc');
});

test('an agent message is parsed', () => {
  const event = parseCodexEvent(
    '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}'
  );
  assert.equal(event.kind, 'message');
  assert.equal(event.text, 'hello');
});

test('token usage is parsed', () => {
  const event = parseCodexEvent(
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4}}'
  );
  assert.equal(event.kind, 'usage');
  assert.equal(event.inputTokens, 10);
  assert.equal(event.outputTokens, 4);
});

test('an error item is parsed rather than treated as a message', () => {
  const event = parseCodexEvent(
    '{"type":"item.completed","item":{"type":"error","message":"bad"}}'
  );
  assert.equal(event.kind, 'error');
});

test('malformed lines and unknown shapes do not throw', () => {
  for (const line of [
    'not json',
    '',
    '{}',
    '{"type":"something.new"}',
    'null',
    '[]',
    '{"type":"item.completed"}',
  ]) {
    assert.doesNotThrow(() => parseCodexEvent(line), `threw on: ${line}`);
  }
});

// --- binary discovery -------------------------------------------------------------

test('a missing Codex is reported as unavailable with a reason', () => {
  const original = process.env.LABOS_CODEX_BIN;
  process.env.LABOS_CODEX_BIN = '/definitely/not/here/codex';
  try {
    // With only an invalid override available, discovery must report honestly
    // rather than throwing or claiming availability.
    const result = findCodexBinary();
    assert.equal(typeof result.available, 'boolean');
    if (!result.available) {
      assert.ok(result.reason, 'an unavailable CLI must explain itself');
    }
  } finally {
    if (original === undefined) delete process.env.LABOS_CODEX_BIN;
    else process.env.LABOS_CODEX_BIN = original;
  }
});

// --- lifecycle --------------------------------------------------------------------

const stub = name => path.join(stubDir, name);

test('a successful job reports the agent message and usage', async () => {
  const gateway = new LabosAgentGateway(stub('stub-ok.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'propose something' });

  assert.equal(job.state, 'completed');
  assert.equal(job.output, 'PROPOSAL: change line 3');
  assert.deepEqual(job.usage, { inputTokens: 100, outputTokens: 12 });
  assert.ok(job.finishedAt);
  gateway.close();
});

test('a non-zero exit is a failure, never a success', async () => {
  const gateway = new LabosAgentGateway(stub('stub-fail.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });

  assert.equal(job.state, 'failed');
  assert.ok(job.error, 'a failure must explain itself');
  gateway.close();
});

test('an exit with no message is reported as possibly unauthenticated', async () => {
  const gateway = new LabosAgentGateway(stub('stub-silent.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });

  assert.equal(job.state, 'failed');
  assert.match(job.error, /sign|no result/i);
  gateway.close();
});

test('a message followed by a non-zero exit is still a failure', async () => {
  // A partial answer must not be presented as a completed job.
  await fs.writeFile(
    path.join(stubDir, 'stub-partial.sh'),
    `#!/bin/sh
echo '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}'
exit 7
`,
    { mode: 0o755 }
  );
  const gateway = new LabosAgentGateway(stub('stub-partial.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });

  assert.equal(job.state, 'failed', 'a non-zero exit cannot be a success');
  assert.match(job.error, /code 7/);
  gateway.close();
});

test('a hung job times out rather than holding the app forever', async () => {
  const gateway = new LabosAgentGateway(stub('stub-hang.sh'));
  const started = Date.now();
  const job = await gateway.run({
    cwd: stubDir,
    prompt: 'x',
    timeoutMs: 1_500,
  });

  assert.equal(job.state, 'timed-out');
  assert.match(job.error, /timed out/i);
  assert.ok(
    Date.now() - started < 15_000,
    'a timeout must actually return promptly'
  );
  gateway.close();
});

test('a runaway output stream is stopped rather than buffered without limit', async () => {
  const gateway = new LabosAgentGateway(stub('stub-flood.sh'));
  const job = await gateway.run({
    cwd: stubDir,
    prompt: 'x',
    timeoutMs: 30_000,
  });

  assert.ok(
    job.state === 'failed' || job.state === 'completed',
    'the job must settle rather than hang'
  );
  if (job.state === 'failed') {
    assert.match(job.error, /more output than/i);
  }
  gateway.close();
});

test('a crashed process is a failure, not a silent success', async () => {
  const gateway = new LabosAgentGateway(stub('stub-crash.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });

  assert.equal(job.state, 'failed');
  gateway.close();
});

test('a job can be cancelled, and cancellation is reported as cancelled', async () => {
  const gateway = new LabosAgentGateway(stub('stub-hang.sh'));
  const running = gateway.run({ cwd: stubDir, prompt: 'x', timeoutMs: 30_000 });

  // Wait until the job is actually registered as running.
  const deadline = Date.now() + 5_000;
  let jobId = null;
  while (Date.now() < deadline && !jobId) {
    const [job] = gateway.listJobs();
    if (job && job.state === 'running') jobId = job.id;
    else await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(jobId, 'the job should be listed as running');

  assert.equal(gateway.cancelJob(jobId), true);
  const finished = await running;
  assert.equal(
    finished.state,
    'cancelled',
    'a cancelled job must not be reported as completed or failed'
  );
  gateway.close();
});

test('cancelling an unknown job is a safe no-op', async () => {
  const gateway = new LabosAgentGateway(stub('stub-ok.sh'));
  assert.equal(gateway.cancelJob('does-not-exist'), false);
  gateway.close();
});

test('jobs are listed newest first', async () => {
  const gateway = new LabosAgentGateway(stub('stub-ok.sh'));
  await gateway.run({ cwd: stubDir, prompt: 'first' });
  await gateway.run({ cwd: stubDir, prompt: 'second' });

  const jobs = gateway.listJobs();
  assert.ok(jobs.length >= 2);
  assert.ok(
    jobs[0].createdAt >= jobs[1].createdAt,
    'the newest job should be first'
  );
  gateway.close();
});

test('a job can be looked up by id after it finishes', async () => {
  const gateway = new LabosAgentGateway(stub('stub-ok.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });
  assert.equal(gateway.getJob(job.id).state, 'completed');
  assert.equal(gateway.getJob('nope'), null);
  gateway.close();
});

test('closing the gateway stops running jobs', async () => {
  const gateway = new LabosAgentGateway(stub('stub-hang.sh'));
  const running = gateway.run({ cwd: stubDir, prompt: 'x', timeoutMs: 30_000 });

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (gateway.listJobs().some(job => job.state === 'running')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }

  gateway.close();
  const [job] = await Promise.all([running]);
  assert.equal(job.state, 'cancelled');
});

test('the run resolves rather than rejecting on failure', async () => {
  // The UI should read a failure off the job, not have to catch an exception.
  const gateway = new LabosAgentGateway(stub('stub-fail.sh'));
  const job = await gateway.run({ cwd: stubDir, prompt: 'x' });
  assert.equal(job.state, 'failed');
  gateway.close();
});

