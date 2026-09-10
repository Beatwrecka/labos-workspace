/**
 * LabOS Workspace — local transcription via whisper.cpp (main process only).
 *
 * Runs `whisper-cli` in a child process. Local by default: the audio never leaves
 * the machine, and the contract below was read from the installed binary rather
 * than guessed:
 *
 *   whisper-cli -m <model> -f <wav> -oj -of <out> -l en -np -nt
 *   -> writes <out>.json with a transcription array, and prints timings to stderr
 *
 * Properties this module is responsible for:
 *
 *  - **Local only.** No network call, no upload, no cloud transcription. The
 *    model is a local file and the audio is a local file.
 *  - **Runs out of process.** Transcription is CPU/GPU heavy; it must never block
 *    the UI thread. Every run is a child process with a timeout.
 *  - **The model is not loaded at startup.** It is loaded per run by the CLI, so
 *    the app does not pay that cost until the reader actually transcribes.
 *  - **Failure is reported, not guessed.** A missing model, missing binary or
 *    empty result are all distinct, actionable outcomes. Silence is never
 *    presented as "no speech detected" unless the tool actually said so.
 *  - **The raw transcript is what the tool produced.** Nothing is cleaned,
 *    normalised or tidyied here; that is a separate, optional step downstream.
 */

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type LabosTranscriptionFailure =
  | 'no-binary'
  | 'no-model'
  | 'no-audio'
  | 'audio-unreadable'
  | 'timeout'
  | 'failed'
  | 'empty-result';

export interface LabosTranscriptionResult {
  ok: boolean;
  /** The raw transcript exactly as the tool produced it. */
  text: string | null;
  /** Segments with timings, when the tool reported them. */
  segments: { start: number; end: number; text: string }[];
  /** Milliseconds actually spent transcribing, measured by LabOS. */
  durationMs: number;
  reason: LabosTranscriptionFailure | null;
  /** Human-readable explanation, safe to show. */
  message: string | null;
  /** Recorded provenance, so a transcript can be traced to what produced it. */
  provenance: {
    engine: 'whisper.cpp';
    model: string;
    language: string;
    binaryPath: string;
  } | null;
}

export interface LabosTranscriptionOptions {
  audioPath: string;
  /** Path to the model. Defaults to the LabOS model cache. */
  modelPath?: string;
  language?: string;
  timeoutMs?: number;
  /** Overridable for tests. */
  binaryPath?: string;
  /** Overridable so the binary can be probed without running a job. */
  runner?: (
    binaryPath: string,
    args: string[],
    timeoutMs: number
  ) => Promise<{ code: number | null; stderr: string }>;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;

/**
 * Locate the whisper.cpp CLI.
 *
 * Checked explicitly rather than relying on the packaged app's PATH, which is
 * minimal on macOS.
 */
export function findWhisperBinary(): string | null {
  const candidates = [
    process.env.LABOS_WHISPER_BIN,
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    path.join(os.homedir(), '.local', 'bin', 'whisper-cli'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/**
 * Where the LabOS model lives.
 *
 * An app-specific cache directory, deliberately not a shared global location:
 * LabOS should not pick up, or overwrite, a model belonging to another tool.
 */
export function defaultModelPath(): string {
  return path.join(os.homedir(), '.cache', 'labos-whisper', 'ggml-base.en.bin');
}

export function findModelPath(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.LABOS_WHISPER_MODEL,
    defaultModelPath(),
  ].filter((value): value is string => Boolean(value));
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/** Whether transcription can run, and exactly why not when it cannot. */
export function transcriptionAvailability(options: {
  modelPath?: string;
} = {}): {
  available: boolean;
  reason: string | null;
  binaryPath: string | null;
  modelPath: string | null;
} {
  const binaryPath = findWhisperBinary();
  if (!binaryPath) {
    return {
      available: false,
      reason:
        'The whisper.cpp command line tool was not found, so local transcription is unavailable.',
      binaryPath: null,
      modelPath: null,
    };
  }
  const modelPath = findModelPath(options.modelPath);
  if (!modelPath) {
    return {
      available: false,
      reason:
        'No Whisper model was found, so local transcription is unavailable. A model must be downloaded before it can run.',
      binaryPath,
      modelPath: null,
    };
  }
  return { available: true, reason: null, binaryPath, modelPath };
}

/**
 * Arguments for a transcription run.
 *
 * Exported so a test can assert the local-only shape: no remote URL, and JSON
 * output so segments survive.
 */
export function buildWhisperArgs(options: {
  modelPath: string;
  audioPath: string;
  outputBase: string;
  language: string;
}): string[] {
  return [
    '-m',
    options.modelPath,
    '-f',
    options.audioPath,
    '-l',
    options.language,
    // JSON so segment timings are preserved, rather than flat text only.
    '-oj',
    '-of',
    options.outputBase,
    // Suppress everything but the result, so stderr stays diagnosable.
    '-np',
    '-nt',
  ];
}

/** Default runner: a child process with a hard timeout. */
async function runProcess(
  binaryPath: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(binaryPath, args, {
      // argv array, never a shell string.
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stderr = '';
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr: stderr.slice(0, 20_000) });
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 3_000);
      if (typeof killer.unref === 'function') killer.unref();
      finish(null);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stderr.on('data', (chunk: Buffer) => {
      // Bounded: whisper.cpp is chatty about backends and timings.
      if (stderr.length < 40_000) stderr += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', code => finish(code));
  });
}

interface WhisperJson {
  transcription?: { timings?: { from?: number; to?: number }; text?: string }[];
  result?: { language?: string };
}

/**
 * Transcribe an audio file locally.
 *
 * Never throws for an expected failure: a missing model or an unreadable file is
 * an outcome the caller reports, not an exception to catch.
 */
export async function transcribeLocally(
  options: LabosTranscriptionOptions
): Promise<LabosTranscriptionResult> {
  const started = Date.now();
  const language = options.language ?? 'en';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fail = (
    reason: LabosTranscriptionFailure,
    message: string,
    provenance: LabosTranscriptionResult['provenance'] = null
  ): LabosTranscriptionResult => ({
    ok: false,
    text: null,
    segments: [],
    durationMs: Date.now() - started,
    reason,
    message,
    provenance,
  });

  const availability = transcriptionAvailability({
    modelPath: options.modelPath,
  });
  const binaryPath = options.binaryPath ?? availability.binaryPath;
  if (!binaryPath) {
    return fail('no-binary', availability.reason ?? 'whisper.cpp was not found.');
  }
  const modelPath = availability.modelPath;
  if (!modelPath) {
    return fail('no-model', availability.reason ?? 'No Whisper model was found.');
  }

  if (!existsSync(options.audioPath)) {
    return fail('no-audio', 'The recording file could not be found.');
  }
  try {
    const stats = await fs.stat(options.audioPath);
    if (!stats.isFile()) {
      return fail('audio-unreadable', 'The recording is not a regular file.');
    }
    if (stats.size === 0) {
      return fail(
        'audio-unreadable',
        'The recording is empty, so there is nothing to transcribe.'
      );
    }
    if (stats.size > MAX_AUDIO_BYTES) {
      return fail(
        'audio-unreadable',
        'The recording is larger than LabOS will transcribe.'
      );
    }
  } catch {
    return fail('audio-unreadable', 'The recording could not be read.');
  }

  // Output goes to a temporary directory LabOS owns, so nothing is written
  // beside the recording or into the repository.
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'labos-asr-'));
  const outputBase = path.join(outputDir, 'transcript');

  const provenance = {
    engine: 'whisper.cpp' as const,
    model: path.basename(modelPath),
    language,
    binaryPath,
  };

  try {
    const args = buildWhisperArgs({
      modelPath,
      audioPath: options.audioPath,
      outputBase,
      language,
    });

    const runner = options.runner ?? runProcess;
    const { code } = await runner(binaryPath, args, timeoutMs);

    if (code === null) {
      return fail(
        'timeout',
        'Transcription did not finish in time and was stopped.',
        provenance
      );
    }

    // The tool writes <base>.json. Its absence with a non-zero exit is a real
    // failure; with a zero exit it still means no transcript was produced.
    const jsonPath = `${outputBase}.json`;
    if (!existsSync(jsonPath)) {
      return fail(
        code === 0 ? 'empty-result' : 'failed',
        code === 0
          ? 'Transcription produced no result. The model may be incomplete.'
          : 'Transcription failed.',
        provenance
      );
    }

    let parsed: WhisperJson;
    try {
      parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as WhisperJson;
    } catch {
      return fail('failed', 'The transcription result could not be read.', provenance);
    }

    const entries = Array.isArray(parsed.transcription) ? parsed.transcription : [];
    const segments = entries.map(entry => ({
      // whisper.cpp reports centiseconds; converted to milliseconds so the unit
      // is unambiguous downstream.
      start: Number(entry.timings?.from ?? 0) * 10,
      end: Number(entry.timings?.to ?? 0) * 10,
      text: String(entry.text ?? '').trim(),
    }));

    // The raw transcript: trimmed, but not otherwise altered. Cleaning is a
    // separate optional step, and the raw version is always kept.
    const text = segments
      .map(segment => segment.text)
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!text) {
      return fail(
        'empty-result',
        'No speech was recognised in this recording. The audio may be silent or too quiet.',
        provenance
      );
    }

    return {
      ok: true,
      text,
      segments,
      durationMs: Date.now() - started,
      reason: null,
      message: null,
      provenance,
    };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}
