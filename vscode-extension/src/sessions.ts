/**
 * Multi-agent session state for the HIM+ VS Code extension.
 *
 * Pure (no `vscode` import) so it can be unit-tested. Each session has its own
 * transcript; the webview shows one at a time, and background subagents report
 * into the session that spawned them.
 */

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  history: SessionMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredSessions {
  activeId: string | null;
  sessions: ChatSession[];
}

export interface SubagentRunInfo {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  startedAt: number;
}

const MAX_HISTORY = 30;
const MAX_SESSIONS = 20;

function uid(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function deriveTitle(history: SessionMessage[]): string {
  const first = history.find((message) => message.role === 'user' && message.content.trim());
  if (!first) return 'New chat';
  const compact = first.content.trim().replace(/\s+/g, ' ');
  return compact.length > 52 ? `${compact.slice(0, 51)}…` : compact;
}

export function createSession(
  history: SessionMessage[] = [],
  title?: string,
  now = Date.now(),
): ChatSession {
  const cleaned = history
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .slice(-MAX_HISTORY)
    .map((message) => ({ role: message.role, content: String(message.content || '') }));
  return {
    id: uid(),
    title: title || deriveTitle(cleaned),
    history: cleaned,
    createdAt: now,
    updatedAt: now,
  };
}

function validSessions(raw: unknown): ChatSession[] {
  if (!Array.isArray(raw)) return [];
  const sessions: ChatSession[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const history = Array.isArray(value.history)
      ? value.history
          .filter((message): message is SessionMessage => {
            if (!message || typeof message !== 'object') return false;
            const entry = message as Record<string, unknown>;
            return (
              (entry.role === 'user' || entry.role === 'assistant') &&
              typeof entry.content === 'string'
            );
          })
          .slice(-MAX_HISTORY)
      : [];
    sessions.push({
      id: typeof value.id === 'string' && value.id ? value.id : uid(),
      title: typeof value.title === 'string' && value.title.trim() ? value.title : deriveTitle(history),
      history,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    });
  }
  return sessions.slice(-MAX_SESSIONS);
}

/** Loads persisted sessions, falling back to the legacy single transcript. */
export function normalizeSessions(raw: unknown, legacyHistory?: unknown): StoredSessions {
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const sessions = validSessions(stored?.sessions);
  if (sessions.length > 0) {
    const activeId =
      typeof stored?.activeId === 'string' && sessions.some((s) => s.id === stored.activeId)
        ? (stored.activeId as string)
        : sessions[sessions.length - 1].id;
    return { sessions, activeId };
  }
  const migrated = Array.isArray(legacyHistory)
    ? legacyHistory
        .filter((message): message is SessionMessage => {
          if (!message || typeof message !== 'object') return false;
          const entry = message as Record<string, unknown>;
          return (
            (entry.role === 'user' || entry.role === 'assistant') &&
            typeof entry.content === 'string'
          );
        })
        .slice(-MAX_HISTORY)
    : [];
  const session = createSession(migrated);
  return { sessions: [session], activeId: session.id };
}

export function findSession(sessions: ChatSession[], id: string | null): ChatSession | null {
  if (!id) return null;
  return sessions.find((session) => session.id === id) || null;
}

/** Prompt for a background helper agent. */
export function subagentTaskPrompt(task: string, label?: string): string {
  return [
    `You are a background helper agent${label ? ` (“${label}”)` : ''} for a main HIM+ agent.`,
    'Work read-only: inspect the workspace, answer the assigned task precisely and concisely.',
    'Do not delegate to further subagents. Return concrete file paths and findings.',
    '',
    'TASK:',
    task.trim(),
  ].join('\n');
}

export function subagentReport(label: string, result: string): string {
  const trimmed = result.trim();
  return `**Background subagent${label ? ` “${label}”` : ''} finished**\n\n${trimmed || '(no output)'}`;
}

/** Compact status text for the model's list_subagents tool. */
export function describeSubagents(runs: SubagentRunInfo[]): string {
  if (runs.length === 0) return 'No subagents have been started in this session.';
  return runs
    .map((run) => {
      if (run.status === 'running') return `- ${run.id} “${run.label}”: running`;
      if (run.status === 'error') return `- ${run.id} “${run.label}”: failed (${run.error || 'error'})`;
      return `- ${run.id} “${run.label}”: done\n${String(run.result || '').slice(0, 1200)}`;
    })
    .join('\n');
}
