/**
 * LabOS Workspace — agent actions panel.
 *
 * The reader-facing surface for the agent. It is built around one idea: the
 * reader should be able to see exactly what is about to be sent, and should
 * never be able to mistake a proposal for an applied change.
 *
 * So:
 *  - every action states what it will send, before it is clicked
 *  - the composed prompt can be inspected in full
 *  - a proposal is labelled as needing review, and there is no apply button
 *  - a failed or cancelled job says so, and never shows a result
 *  - when Codex is unavailable, the panel says why instead of failing silently
 */

import { Button } from '@affine/component';
import { useCallback, useState } from 'react';

import {
  composePrompt,
  labelForResult,
  LABOS_AGENT_ACTIONS,
  type LabosAgentActionId,
} from './agent-actions';
import {
  actionButton,
  actionDescription,
  actionLabel,
  actionRow,
  cancelButton,
  jobCard,
  jobHeader,
  jobLabel,
  jobMeta,
  jobState,
  panel,
  previewToggle,
  promptPreview,
  proposalNotice,
  questionInput,
  resultBody,
  unavailable,
} from './agent-styles.css';

export interface LabosAgentJobView {
  id: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed-out';
  output: string | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface LabosAgentPanelProps {
  /** Whether the agent can run at all, and why not when it cannot. */
  availability: { available: boolean; reason: string | null };
  /** Repository-relative path of the document in view. */
  relativePath: string;
  /** The document text. Sent as data, never as instructions. */
  content: string;
  /** The document's working directory, for the agent's read-only root. */
  cwd: string;
  projectName?: string | null;
  /** Runs a job and returns its outcome. */
  runAgent: (input: {
    action: string;
    cwd: string;
    prompt: string;
  }) => Promise<
    | { ok: true; job: LabosAgentJobView }
    | { ok: false; reason: string }
  >;
  cancelAgent: (jobId: string) => Promise<{ cancelled: boolean }>;
}

export function LabosAgentPanel({
  availability,
  relativePath,
  content,
  cwd,
  projectName,
  runAgent,
  cancelAgent,
}: LabosAgentPanelProps) {
  const [question, setQuestion] = useState('');
  const [showPreviewFor, setShowPreviewFor] = useState<LabosAgentActionId | null>(
    null
  );
  const [job, setJob] = useState<LabosAgentJobView | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<LabosAgentActionId | null>(
    null
  );
  const [lastAction, setLastAction] = useState<LabosAgentActionId | null>(null);

  const handleRun = useCallback(
    async (actionId: LabosAgentActionId) => {
      setRequestError(null);
      setRunningAction(actionId);
      setLastAction(actionId);
      setJob(null);

      const composed = composePrompt({
        action: actionId,
        relativePath,
        content,
        question: actionId === 'ask' ? question : undefined,
        projectName,
      });

      try {
        const result = await runAgent({
          action: actionId,
          cwd,
          prompt: composed.prompt,
        });
        if (result.ok) {
          setJob(result.job);
        } else {
          // A refusal to start is not a job that failed; it never ran.
          setRequestError(result.reason);
        }
      } catch (error) {
        setRequestError(
          error instanceof Error ? error.message : 'The agent could not be reached.'
        );
      } finally {
        setRunningAction(null);
      }
    },
    [content, cwd, projectName, question, relativePath, runAgent]
  );

  // Unavailable is stated plainly, with the actions disabled rather than hidden:
  // the reader can see what would be possible once Codex is set up.
  if (!availability.available) {
    return (
      <div className={panel}>
        <p className={unavailable}>
          <strong>Agent actions are unavailable.</strong>{' '}
          {availability.reason ??
            'The Codex CLI was not found or is not signed in.'}{' '}
          Your notes and repository documents work normally without it.
        </p>
      </div>
    );
  }

  const busy = runningAction !== null;

  return (
    <div className={panel}>
      {question !== null && (
        <label>
          <span className={actionDescription}>
            Ask a question about this document
          </span>
          <textarea
            className={questionInput}
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="What does this document say about deployment?"
            aria-label="Question about this document"
          />
        </label>
      )}

      <div className={actionRow}>
        {LABOS_AGENT_ACTIONS.map(action => (
          <button
            key={action.id}
            type="button"
            className={actionButton}
            disabled={busy}
            onClick={() => {
              handleRun(action.id).catch(() => {});
            }}
            aria-label={`${action.label}. ${action.description}`}
          >
            <span className={actionLabel}>
              {runningAction === action.id ? `${action.label}…` : action.label}
            </span>
            <span className={actionDescription}>{action.description}</span>
          </button>
        ))}
      </div>

      {/* What will be sent, inspectable BEFORE it is sent in the common case and
          in full on request. Nothing is hidden about the payload. */}
      {lastAction ? (
        <>
          <button
            type="button"
            className={previewToggle}
            aria-expanded={showPreviewFor === lastAction}
            onClick={() =>
              setShowPreviewFor(current => (current === lastAction ? null : lastAction))
            }
          >
            {showPreviewFor === lastAction
              ? 'Hide what was sent'
              : 'Show what was sent'}
          </button>
          {showPreviewFor === lastAction ? (
            <pre className={promptPreview}>
              {
                composePrompt({
                  action: lastAction,
                  relativePath,
                  content,
                  question: lastAction === 'ask' ? question : undefined,
                  projectName,
                }).prompt
              }
            </pre>
          ) : null}
        </>
      ) : null}

      {requestError ? (
        <p className={unavailable} role="status">
          {requestError}
        </p>
      ) : null}

      {job ? (
        <div className={jobCard}>
          <div className={jobHeader}>
            <span className={jobLabel}>
              {labelForResult(
                (lastAction ?? 'ask') as LabosAgentActionId,
                job.state === 'completed'
              )}
            </span>
            <span className={jobState[job.state]}>{describeState(job.state)}</span>
          </div>

          {job.state === 'completed' && job.output ? (
            <>
              {(lastAction === 'propose-edits' || lastAction === 'link-memory') && (
                <p className={proposalNotice}>
                  This is a proposal. Nothing has been written to the file or
                  submitted anywhere. Review it and apply any change yourself.
                </p>
              )}
              <pre className={resultBody}>{job.output}</pre>
            </>
          ) : null}

          {/* A result exists only for a completed job. A failed, cancelled or
              timed-out job shows why and nothing else. */}
          {job.state !== 'completed' ? (
            <p className={resultBody}>
              {job.error ?? 'The job did not complete, so there is no result.'}
            </p>
          ) : null}

          <span className={jobMeta}>
            {job.usage
              ? `${job.usage.inputTokens} input tokens, ${job.usage.outputTokens} output`
              : 'No usage reported'}
            {' · read-only'}
          </span>

          {job.state === 'running' ? (
            <Button
              variant="plain"
              onClick={() => {
                cancelAgent(job.id).catch(() => {});
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {busy && !job ? (
        <div className={jobCard}>
          <div className={jobHeader}>
            <span className={jobLabel}>Working…</span>
            <span className={jobState.running}>Running</span>
          </div>
          <span className={jobMeta}>
            Codex is reading the document in read-only mode. This can take a
            minute.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Job states are words, so colour is never the only signal. */
function describeState(state: LabosAgentJobView['state']): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'timed-out':
      return 'Timed out';
  }
}

export { cancelButton };
