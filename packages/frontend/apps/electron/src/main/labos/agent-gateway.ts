/**
 * LabOS Workspace — Codex agent gateway (main process only).
 *
 * Spawns the installed `codex` CLI in non-interactive mode for bounded one-off
 * jobs. The contract below was verified against the installed CLI (0.146.0)
 * rather than guessed:
 *
 *   codex exec -s read-only --json -C <dir> "<prompt>"
 *   -> JSONL on stdout: thread.started, item.completed, turn.completed
 *
 * The `-s read-only` flag was empirically tested: asked to overwrite a file, the
 * run failed with "sandbox_apply: Operation not permitted" and the file was
 * unchanged. That is why every job starts read-only.
 *
 * Safety properties this module is responsible for:
 *
 *  - **Read-only by default, permanently for proposals.** There is no code path
 *    here that passes `--dangerously-bypass-approvals-and-sandbox`,
 *    `workspace-write` or `danger-full-access`. A proposal is a proposal.
 *  - **No shell injection.** Arguments are passed as an argv array, never
 *    interpolated into a shell string.
 *  - **Bounded.** A job has a timeout, an output size ceiling, and can be
 *    cancelled. A hung or runaway agent cannot hold the app.
 *  - **Untrusted content is data.** Document text goes in the prompt as clearly
 *    delimited data, and the prompt states that it is not instructions.
 *  - **No token handling.** LabOS never reads Codex credentials; it runs the
 *    user's own authenticated CLI and reports failure if it is not signed in.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LabosAgentJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out';

export interface LabosAgentJob {
  id: string;
  state: LabosAgentJobState;
  /** Final agent message, when the job completed. */
  output: string | null;
  /** Failure explanation, when it did not. */
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Token usage reported by the CLI, when available. */
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface LabosAgentRunOptions {
  /** Working directory the agent may read. Never a writable mode. */
  cwd: string;
  /** The task, already composed by the caller. */
  prompt: string;
  timeoutMs?: number;
}

export interface LabosAgentAvailability {
  available: boolean;
  /** Why it is unavailable, so the UI can say something true. */
  reason: string | null;
  binaryPath: string | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_JOBS_RETAINED = 50;

/**
 * Locate the Codex CLI.
 *
 * Checked explicitly rather than relying on the app's PATH, which on a packaged
 * macOS app is minimal and would otherwise make this silently unavailable.
 */
export function findCodexBinary(): LabosAgentAvailability {
  const candidates = [
    process.env.LABOS_CODEX_BIN,
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { available: true, reason: null, binaryPath: candidate };
    }
  }
  return {
    available: false,
    reason:
      'The Codex CLI was not found. Install it and sign in, then this becomes available again.',
    binaryPath: null,
  };
}

/**
 * Arguments for a read-only, non-interactive run.
 *
 * Kept as a separate exported function so a test can assert that no dangerous
 * flag ever appears, which is cheaper and more durable than trusting review.
 */
export function buildCodexArgs(options: {
  cwd: string;
  prompt: string;
}): string[] {
  return [
    'exec',
    // Read-only is the ONLY sandbox mode this app uses.
    '-s',
    'read-only',
    // Structured JSONL, so progress and the final message can be distinguished.
    '--json',
    // Explicit working root, so the agent cannot wander into the home directory.
    '-C',
    options.cwd,
    // Codex refuses to run in a directory it does not consider trusted unless
    // this is passed, and it refuses by waiting on stdin rather than exiting —
    // which looks exactly like a hang. A registered repository folder is a
    // directory the user explicitly chose, so this is the correct call; the
    // sandbox remains read-only regardless.
    '--skip-git-repo-check',
    options.prompt,
  ];
}

/** Parse one JSONL line into a typed event, tolerating unknown shapes. */
export function parseCodexEvent(line: string):
  | { kind: 'message'; text: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'thread-started'; threadId: string }
  | { kind: 'error'; message: string }
  | { kind: 'other' } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'other' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'other' };
  const event = parsed as Record<string, unknown>;

  if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
    return { kind: 'thread-started', threadId: event.thread_id };
  }

  if (event.type === 'item.completed') {
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      return { kind: 'message', text: item.text };
    }
    if (item?.type === 'error' && typeof item.message === 'string') {
      return { kind: 'error', message: item.message };
    }
  }

  if (event.type === 'turn.completed') {
    const usage = event.usage as Record<string, unknown> | undefined;
    return {
      kind: 'usage',
      inputTokens: Number(usage?.input_tokens ?? 0),
      outputTokens: Number(usage?.output_tokens ?? 0),
    };
  }

  return { kind: 'other' };
}

export class LabosAgentGateway {
  readonly #binaryPath: string;
  readonly #jobs = new Map<string, LabosAgentJob>();
  readonly #running = new Map<string, ChildProcessWithoutNullStreams>();
  readonly #order: string[] = [];

  constructor(binaryPath: string) {
    this.#binaryPath = binaryPath;
  }

  /** Current job states, newest first. */
  listJobs(): LabosAgentJob[] {
    return this.#order
      .map(id => this.#jobs.get(id))
      .filter((job): job is LabosAgentJob => Boolean(job));
  }

  getJob(id: string): LabosAgentJob | null {
    return this.#jobs.get(id) ?? null;
  }

  /**
   * Cancel a running job.
   *
   * SIGTERM first, then SIGKILL if it does not exit: a runaway agent must not be
   * able to hold the app open.
   */
  cancelJob(id: string): boolean {
    const child = this.#running.get(id);
    const job = this.#jobs.get(id);
    if (!child || !job) return false;

    job.state = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.error = 'Cancelled.';

    child.kill('SIGTERM');
    const killer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 3_000);
    if (typeof killer.unref === 'function') killer.unref();

    return true;
  }

  /**
   * Run one bounded job.
   *
   * Resolves with the finished job. It never rejects for an agent failure, so a
   * failed job is a reported outcome rather than an exception the UI has to
   * guess at.
   */
  async run(options: LabosAgentRunOptions): Promise<LabosAgentJob> {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const job: LabosAgentJob = {
      id,
      state: 'running',
      output: null,
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      usage: null,
    };
    this.#jobs.set(id, job);
    this.#order.unshift(id);
    while (this.#order.length > MAX_JOBS_RETAINED) {
      const dropped = this.#order.pop();
      if (dropped) this.#jobs.delete(dropped);
    }

    const args = buildCodexArgs(options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<LabosAgentJob>(resolve => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.#binaryPath, args, {
          cwd: options.cwd,
          // An argv array, never a shell string, so nothing can be injected.
          shell: false,
          // The prompt is passed as an argument, so stdin must be closed. A CLI
          // that decides to read stdin would otherwise sit there until the
          // timeout, which looks exactly like a hang and wastes the budget.
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Ask Codex not to use colour codes in a machine-read stream.
            NO_COLOR: '1',
          },
        }) as ChildProcessWithoutNullStreams;
      } catch (error) {
        job.state = 'failed';
        job.error =
          error instanceof Error
            ? `Could not start Codex: ${error.message}`
            : 'Could not start Codex.';
        job.finishedAt = new Date().toISOString();
        resolve(job);
        return;
      }

      this.#running.set(id, child);

      let buffer = '';
      let bytes = 0;
      let truncated = false;
      let lastMessage: string | null = null;

      const settle = (state: LabosAgentJobState, error: string | null) => {
        if (job.state === 'cancelled') return; // cancellation already decided
        job.state = state;
        job.error = error;
        job.output = lastMessage;
        job.finishedAt = new Date().toISOString();
        this.#running.delete(id);
        clearTimeout(timer);
        resolve(job);
      };

      const timer = setTimeout(() => {
        job.error = `Timed out after ${Math.round(timeoutMs / 1000)}s.`;
        child.kill('SIGTERM');
        const killer = setTimeout(() => child.kill('SIGKILL'), 3_000);
        if (typeof killer.unref === 'function') killer.unref();
        settle('timed-out', job.error);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          if (!truncated) {
            truncated = true;
            child.kill('SIGTERM');
          }
          return;
        }
        buffer += chunk.toString('utf8');
        // JSONL: process whole lines, keep any partial tail for the next chunk.
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            const event = parseCodexEvent(line);
            if (event.kind === 'message') lastMessage = event.text;
            if (event.kind === 'usage') {
              job.usage = {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              };
            }
          }
          newline = buffer.indexOf('\n');
        }
      });

      child.on('error', error => {
        settle('failed', `Codex could not run: ${error.message}`);
      });

      child.on('close', code => {
        if (truncated) {
          settle(
            'failed',
            'Codex produced more output than LabOS will read, so it was stopped.'
          );
          return;
        }
        if (job.state === 'cancelled') {
          this.#running.delete(id);
          clearTimeout(timer);
          resolve(job);
          return;
        }
        if (code === 0 && lastMessage !== null) {
          settle('completed', null);
          return;
        }
        // A non-zero exit with a message still counts as failed: the CLI did not
        // complete the task, and saying otherwise would be a false success.
        settle(
          'failed',
          lastMessage
            ? `Codex exited with code ${code}.`
            : 'Codex produced no result. It may not be signed in.'
        );
      });
    });
  }

  /** Kill every running job, for app shutdown. */
  close(): void {
    for (const [id] of this.#running) {
      this.cancelJob(id);
    }
  }
}
