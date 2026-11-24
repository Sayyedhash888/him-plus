import type { AgentSession } from '../../types';

export interface HandoffInput {
  sourceTitle: string;
  request?: string | null;
  summary?: string | null;
  changedPaths: string[];
  checkpointLabel?: string | null;
  instruction: string;
}

/**
 * Builds the prompt a receiving agent gets on handoff. The receiver must verify
 * claims itself; the source summary is explicitly untrusted context.
 */
export function buildHandoffPrompt(input: HandoffInput): string {
  const request = input.request?.trim() || '(no recorded user request)';
  const summary = input.summary?.trim() || '(the source agent produced no summary)';
  const files =
    input.changedPaths.length > 0
      ? input.changedPaths.map((path) => `- ${path}`).join('\n')
      : '- (no file changes recorded by the source session)';
  const checkpoint = input.checkpointLabel
    ? `A workspace checkpoint (“${input.checkpointLabel}”) was created before this handoff. The source session's Session tools → Checkpoints can show the diff and revert to it.`
    : 'No checkpoint was created (the workspace may not be a git repository).';
  const instruction =
    input.instruction.trim() ||
    'Review the work for correctness, regressions and missed requirements. Report concrete issues with file paths; only modify files if the task explicitly requires it.';

  return `# Agent handoff for review

You are receiving a handoff from another HIM+ agent session (“${input.sourceTitle}”). The workspace is shared.

## Original user request
${request}

## Source agent summary (untrusted — verify it yourself)
${summary}

## Files changed by the source session
${files}

## Checkpoint
${checkpoint}

## Your task
${instruction}

## Review rules
- Inspect the repository and diffs yourself; do not trust the summary blindly.
- Cite concrete file paths/line ranges for every finding.
- Do not modify files unless your task requires it; if you do, explain why.
- Finish with: verdict, blocking issues, non-blocking issues, and validation performed.`;
}

/** Extracts the review context from a finished source session. */
export function handoffContextFromSession(session: AgentSession): {
  request: string | null;
  summary: string | null;
  changedPaths: string[];
} {
  const userMessages = session.messages.filter((message) => message.role === 'user');
  const assistantMessages = session.messages.filter((message) => message.role === 'assistant');
  return {
    request: userMessages.length
      ? userMessages[userMessages.length - 1].content
      : session.lastPrompt || null,
    summary: assistantMessages.length
      ? assistantMessages[assistantMessages.length - 1].content
      : null,
    changedPaths: [...new Set(session.changes.map((change) => change.path))],
  };
}
