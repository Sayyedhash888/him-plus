import type {
  ChatConversationRecord,
  ChatSessionSnapshot,
  StoredChatMessage,
} from '@shared/types';
import type { AgentSession, ChatEntry, ToolCallState } from '../types';
import { him } from './bridge';
import { useSessionStore } from '../store/sessions';

const SAVE_INTERVAL_MS = 300;

/** Keeps undo history across restarts without letting the store grow forever. */
const MAX_PERSISTED_CHANGES = 60;

function stableChanges(changes: AgentSession['changes']): AgentSession['changes'] {
  return changes.slice(-MAX_PERSISTED_CHANGES).map((change) => ({ ...change }));
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastSavedAt = new Map<string, number>();
let started = false;

function toStoredMessages(messages: ChatEntry[]): StoredChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content || '',
    reasoning: message.reasoning,
    toolName: message.toolName,
    toolCallId: message.toolCallId,
    createdAt: message.createdAt,
  }));
}

function toSnapshot(session: AgentSession): ChatSessionSnapshot {
  const stableMessages = session.messages.map((message) => ({
    ...message,
    streaming: false,
  }));
  const stableToolCalls = stableMessages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((call) =>
      call.status === 'running' || call.status === 'waiting'
        ? { ...call, status: 'error' as const, result: 'Interrupted by app restart.' }
        : call,
    ),
  }));
  const data = JSON.stringify({
    ...session,
    messages: stableToolCalls,
    changes: stableChanges(session.changes),
    terminalRuns: [],
    pendingApproval: null,
    status: session.status === 'running' || session.status === 'waiting' ? 'stopped' : session.status,
  });
  return {
    id: session.id,
    title: session.title,
    workspaceRoot: session.workspaceRoot,
    backend: session.backend || 'him',
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    data,
    messages: toStoredMessages(stableMessages),
  };
}

async function persistSession(sessionId: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session || session.messages.length === 0) {
    lastSavedAt.delete(sessionId);
    await him.chats.deleteSession(sessionId);
    return;
  }
  await him.chats.saveSession(toSnapshot(session));
  lastSavedAt.set(sessionId, Date.now());
}

function scheduleSave(sessionId: string): void {
  if (timers.has(sessionId)) return;
  const elapsed = Date.now() - (lastSavedAt.get(sessionId) || 0);
  const delay = Math.max(0, SAVE_INTERVAL_MS - elapsed);
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    void persistSession(sessionId).catch((error) => {
      console.warn('[chats] failed to save conversation', error);
    });
  }, delay);
  timers.set(sessionId, timer);
}

export function startChatSync(): void {
  if (started) return;
  started = true;
  useSessionStore.subscribe((state, previous) => {
    const previousById = new Map(previous.sessions.map((session) => [session.id, session]));
    for (const session of state.sessions) {
      if (previousById.get(session.id) !== session) scheduleSave(session.id);
    }
    for (const session of previous.sessions) {
      if (!state.sessions.some((item) => item.id === session.id)) {
        const timer = timers.get(session.id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(session.id);
        }
        lastSavedAt.delete(session.id);
        void him.chats.deleteSession(session.id);
      }
    }
  });

  window.addEventListener('pagehide', () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const sessions = useSessionStore.getState().sessions;
    for (const session of sessions) {
      if (session.messages.length === 0) continue;
      void him.chats.saveSession(toSnapshot(session));
    }
  });
}

function normalizeRestoredSession(record: ChatConversationRecord): AgentSession | null {
  let parsed: AgentSession;
  try {
    parsed = JSON.parse(record.data) as AgentSession;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  if (messages.length === 0) return null;
  const restoredMessages: ChatEntry[] = messages.map((message) => {
    const toolCalls: ToolCallState[] | undefined = Array.isArray(message.toolCalls)
      ? message.toolCalls.map((call) =>
          call.status === 'running' || call.status === 'waiting'
            ? {
                ...call,
                status: 'error' as const,
                result: 'Interrupted by app restart.',
              }
            : call,
        )
      : undefined;
    return {
      ...message,
      streaming: false,
      toolCalls,
    };
  });
  return {
    ...parsed,
    title: typeof parsed.title === 'string' ? parsed.title : 'Previous conversation',
    status:
      parsed.status === 'running' || parsed.status === 'waiting' ? 'stopped' : parsed.status,
    permission: parsed.permission || 'review',
    messages: restoredMessages,
    changes: Array.isArray(parsed.changes) ? stableChanges(parsed.changes) : [],
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    terminalRuns: [],
    tokens: parsed.tokens || { input: 0, output: 0 },
    workspaceRoot: typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : record.workspaceRoot,
    worktree: parsed.worktree || null,
    model: parsed.model || null,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : record.createdAt,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : record.updatedAt,
    pendingApproval: null,
    error: parsed.error,
  };
}

export async function hydrateChats(): Promise<void> {
  try {
    const records = await him.chats.listSessions();
    const restored = records
      .map(normalizeRestoredSession)
      .filter((session): session is AgentSession => Boolean(session))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    if (restored.length === 0) return;
    useSessionStore.getState().hydrateSessions(restored);
  } catch (error) {
    console.warn('[chats] failed to restore previous conversations', error);
  }
}