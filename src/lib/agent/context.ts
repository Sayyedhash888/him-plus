import type { AgentSession, ChatEntry } from '../../types';
import { him } from '../bridge';
import { compactDiffPreview } from '../diff';
import { workspacePath } from '../paths';
import { getAgentHost } from './host';

export interface MentionToken {
  raw: string;
  target: string;
  index: number;
  length: number;
}

const MENTION_REGEX = /(^|\s)@(?:"([^"]+)"|([^\s@]+))/g;

export function findMentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  MENTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const prefix = match[1] || '';
    const target = match[2] || match[3] || '';
    const index = match.index + prefix.length;
    const raw = `@${match[2] ? `"${match[2]}"` : target}`;
    tokens.push({ raw, target, index, length: raw.length });
  }
  return tokens;
}

export function activeMentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@(?:"([^"]*)"?|([^\s@]*))$/.exec(before);
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3] || '';
}

export interface ExpandedPrompt {
  apiContent: string;
  attachments: string[];
}

const MAX_FILE_CONTEXT = 26_000;
const MAX_TOTAL_CONTEXT = 90_000;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} characters]`;
}

function codeFence(pathLabel: string, content: string): string {
  return `<file path="${pathLabel}">\n${clip(content, MAX_FILE_CONTEXT)}\n</file>`;
}

function diffContext(session: AgentSession): string {
  if (session.changes.length === 0) return 'No file changes recorded in this session.';
  const chunks: string[] = [];
  for (const change of session.changes.slice(-8)) {
    const rows = compactDiffPreview(change.before, change.after, 90);
    const body = rows
      .map((row) => {
        if (row.type === 'add') return `+ ${row.text}`;
        if (row.type === 'remove') return `- ${row.text}`;
        return `  ${row.text}`;
      })
      .join('\n');
    chunks.push(
      `--- ${change.path} (${change.status}, +${change.added} −${change.removed})\n${body}`,
    );
  }
  return clip(chunks.join('\n\n'), 18_000);
}

async function contextForTarget(target: string, session: AgentSession): Promise<string | null> {
  const workspaceFiles = getAgentHost().getWorkspaceContext(session.workspaceRoot).files;
  if (target === 'terminal') {
    const lastFromEditor = getAgentHost().readLastTerminal?.() ?? null;
    const lastFromAgent = session.terminalRuns[session.terminalRuns.length - 1];
    const record = lastFromEditor
      ? {
          command: lastFromEditor.command,
          cwd: lastFromEditor.cwd,
          output: lastFromEditor.output,
          code: lastFromEditor.code,
        }
      : lastFromAgent
        ? {
            command: lastFromAgent.command,
            cwd: lastFromAgent.cwd,
            output: lastFromAgent.output,
            code: lastFromAgent.code ?? null,
          }
        : null;
    if (!record) return '<terminal>No terminal output has been captured yet.</terminal>';
    return `<terminal command="${record.command}" cwd="${record.cwd}" exit="${record.code ?? 'running'}">\n${clip(
      record.output,
      12_000,
    )}\n</terminal>`;
  }
  if (target === 'diff') {
    return `<session-diff>\n${diffContext(session)}\n</session-diff>`;
  }

  const cleanTarget = target.replace(/\/+$/, '');
  const candidate = workspaceFiles.find(
    (file) => file.toLowerCase() === cleanTarget.toLowerCase(),
  );

  if (candidate) {
    try {
      const resolved = workspacePath(session.workspaceRoot, candidate);
      const file = await him.fs.readFile(resolved.abs);
      if (file.binary) return `<file path="${candidate}">[binary file omitted]</file>`;
      return codeFence(candidate, file.content);
    } catch (error) {
      return `<file path="${candidate}">[could not read: ${(error as Error).message}]</file>`;
    }
  }

  // Try a directory listing for explicit folders.
  try {
    const resolved = workspacePath(session.workspaceRoot, cleanTarget);
    const entries = await him.fs.readDir(resolved.abs);
    const listing = entries
      .slice(0, 120)
      .map((entry) => `${entry.isDirectory ? '[dir]' : '[file]'} ${entry.name}`)
      .join('\n');
    return `<folder path="${cleanTarget}">\n${listing}\n</folder>`;
  } catch {
    return null;
  }
}

export async function expandPromptMentions(
  text: string,
  session: AgentSession,
): Promise<ExpandedPrompt> {
  const tokens = findMentionTokens(text);
  if (tokens.length === 0) return { apiContent: text, attachments: [] };
  const unique = new Map<string, string>();
  for (const token of tokens) {
    if (unique.has(token.target)) continue;
    const context = await contextForTarget(token.target, session);
    if (context) unique.set(token.target, context);
  }
  if (unique.size === 0) return { apiContent: text, attachments: [] };
  let total = 0;
  const blocks: string[] = [];
  for (const [target, block] of unique.entries()) {
    if (total + block.length > MAX_TOTAL_CONTEXT) {
      blocks.push(`<context-omitted target="${target}">Context budget reached.</context-omitted>`);
      break;
    }
    total += block.length;
    blocks.push(block);
  }
  return {
    apiContent: `${text}\n\n<attached-context>\n${blocks.join('\n\n')}\n</attached-context>`,
    attachments: [...unique.keys()],
  };
}

export function summarizeSessionLocally(session: AgentSession): string {
  const lines: string[] = [];
  const userMessages = session.messages.filter((message) => message.role === 'user').slice(-8);
  if (userMessages.length) {
    lines.push('User requests:');
    for (const message of userMessages) {
      lines.push(`- ${clip(message.content.replace(/\s+/g, ' '), 220)}`);
    }
  }
  const toolActions = session.messages
    .flatMap((message) => message.toolCalls || [])
    .filter((call) => call.status === 'done')
    .slice(-14);
  if (toolActions.length) {
    lines.push('Recent actions:');
    for (const call of toolActions) {
      const detail = call.meta?.path || call.meta?.command || call.meta?.query || '';
      lines.push(`- ${call.name}${detail ? `: ${clip(detail, 120)}` : ''}`);
    }
  }
  if (session.changes.length) {
    const stats = session.changes.reduce(
      (acc, change) => {
        acc.added += change.added;
        acc.removed += change.removed;
        return acc;
      },
      { added: 0, removed: 0 },
    );
    lines.push(
      `Files touched: ${session.changes.map((change) => change.path).join(', ')} (+${stats.added} −${stats.removed})`,
    );
  }
  if (session.artifacts.length) {
    lines.push(`Artifacts: ${session.artifacts.map((artifact) => artifact.title).join('; ')}`);
  }
  return `Earlier context was compacted locally. Preserve these facts:\n${lines.join('\n')}`.slice(
    0,
    4000,
  );
}

export function detectPlanArtifact(
  session: AgentSession,
  message: ChatEntry,
): { title: string; kind: 'plan' | 'notes'; content: string } | null {
  if (message.role !== 'assistant' || message.streaming || message.content.length < 140) return null;
  const isPlan = session.permission === 'plan';
  const hasStructure = /(^|\n)#{1,3}\s+/m.test(message.content);
  if (!isPlan || !hasStructure) return null;
  const heading = /(^|\n)#{1,2}\s+(.+)/.exec(message.content);
  return {
    title: heading?.[2]?.trim() || 'Implementation plan',
    kind: 'plan',
    content: message.content,
  };
}
