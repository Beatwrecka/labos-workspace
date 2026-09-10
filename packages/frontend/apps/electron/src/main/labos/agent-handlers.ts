/**
 * LabOS Workspace — agent IPC handlers.
 *
 * Connects the renderer to the Codex gateway. Three rules this layer enforces:
 *
 *  - **Read-only, always.** It calls `gateway.run`, which only ever passes
 *    `-s read-only`. There is no apply/commit path here, and there should not be
 *    one until there is a reviewed diff.
 *  - **A missing or unauthenticated Codex is reported, not faked.** Availability
 *    is checked before running, and a job that produces nothing says the CLI may
 *    not be signed in.
 *  - **Prompt composition lives in the renderer-visible module** so the reader can
 *    be shown exactly what will be sent. This layer just carries it.
 */

import type { NamespaceHandlers } from '../type';
import {
  findCodexBinary,
  LabosAgentGateway,
  type LabosAgentJob,
} from './agent-gateway';

let gateway: LabosAgentGateway | null = null;
let binaryPath: string | null = null;

function getGateway(): LabosAgentGateway | null {
  if (gateway) return gateway;
  const availability = findCodexBinary();
  if (!availability.available || !availability.binaryPath) return null;
  binaryPath = availability.binaryPath;
  gateway = new LabosAgentGateway(availability.binaryPath);
  return gateway;
}

export const labosAgentHandlers = {
  /** Whether agents are usable, and why not when they are not. */
  availability: async () => {
    const availability = findCodexBinary();
    return {
      available: availability.available,
      reason: availability.reason,
      /** The resolved path is useful for support, not for display. */
      binaryPath: availability.binaryPath,
      readOnly: true as const,
    };
  },

  /**
   * Run one bounded, read-only job.
   *
   * Resolves with the job, including a failure. It never throws for an agent
   * problem, so the UI reads the outcome rather than catching an exception.
   */
  run: async (
    _e: Electron.IpcMainInvokeEvent,
    input: {
      action: string;
      cwd: string;
      prompt: string;
      timeoutMs?: number;
    }
  ): Promise<
    | { ok: true; job: LabosAgentJob }
    | { ok: false; reason: string }
  > => {
    if (!input || typeof input.cwd !== 'string' || typeof input.prompt !== 'string') {
      return { ok: false, reason: 'The agent request was malformed.' };
    }
    if (!input.prompt.trim()) {
      return { ok: false, reason: 'There was nothing to send.' };
    }

    const runner = getGateway();
    if (!runner) {
      return {
        ok: false,
        reason:
          findCodexBinary().reason ??
          'The Codex CLI is not available, so agent actions cannot run.',
      };
    }

    const job = await runner.run({
      cwd: input.cwd,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
    });
    return { ok: true, job };
  },

  /** Cancel a running job. */
  cancel: async (_e: Electron.IpcMainInvokeEvent, jobId: string) => {
    const runner = getGateway();
    if (!runner) return { cancelled: false };
    return { cancelled: runner.cancelJob(jobId) };
  },

  /** Recent jobs, newest first, so the UI can show a history. */
  listJobs: async () => {
    const runner = getGateway();
    return runner ? runner.listJobs() : [];
  },

  getJob: async (_e: Electron.IpcMainInvokeEvent, jobId: string) => {
    const runner = getGateway();
    return runner ? runner.getJob(jobId) : null;
  },
} satisfies NamespaceHandlers;

/** Stop running jobs on app shutdown. */
export function closeLabosAgents(): void {
  gateway?.close();
  gateway = null;
  binaryPath = null;
}

export { binaryPath };
