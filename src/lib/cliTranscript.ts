/**
 * Helpers for the terminal-CLI agent transcript. The PTY is the source of truth
 * while running, but HIM+ mirrors prompts/output into AgentSession.messages so
 * SQLite persistence, token estimates and context compaction all work like the
 * native/ACP backends.
 */

export interface MirrorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  compactionNote?: boolean;
}

export interface CliSegmentLike {
  prompt: string;
  raw: string;
}

/** Rough token estimate (no provider usage exists for a PTY). */
export function estimateTokens(text: string): number {
  const compact = String(text || '');
  if (!compact.trim()) return 0;
  return Math.max(1, Math.ceil(compact.length / 4));
}

/** Rebuilds chat-view segments from persisted messages (after an app restart). */
export function buildSegmentsFromMessages(messages: MirrorMessage[]): CliSegmentLike[] {
  const segments: CliSegmentLike[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      segments.push({ prompt: message.content, raw: '' });
    } else if (message.role === 'assistant') {
      if (segments.length === 0) segments.push({ prompt: '', raw: '' });
      const last = segments[segments.length - 1];
      last.raw = `${last.raw}${last.raw ? '\n\n' : ''}${message.content}`;
    } else if (message.compactionNote) {
      segments.push({ prompt: '', raw: message.content });
    }
  }
  return segments;
}

/** Estimated prompt+output size of the persisted CLI transcript. */
export function cliTranscriptChars(messages: MirrorMessage[]): number {
  return messages.reduce((total, message) => total + (message.content?.length || 0), 0);
}

/** Auto-compaction threshold: long PTY sessions stay usable instead of unbounded. */
export const CLI_COMPACT_CHARS = 90_000;

export function shouldCompactCli(messages: MirrorMessage[]): boolean {
  if (messages.length < 8) return false;
  return cliTranscriptChars(messages) >= CLI_COMPACT_CHARS;
}

/** Trims oversized terminal output before storing it in the session transcript. */
export function clipCliOutput(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  return `[... ${text.length - maxChars} chars of terminal output omitted ...]\n${text.slice(-maxChars)}`;
}
