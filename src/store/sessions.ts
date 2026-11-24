import { create } from 'zustand';
import type {
  AgentChange,
  AgentSession,
  AgentTerminalRun,
  Artifact,
  ChatEntry,
  PermissionMode,
  ToolCallState,
} from '../types';
import type { ModelRef } from '@shared/types';
import { uid } from '../lib/utils';

export interface CreateSessionInput {
  workspaceRoot: string;
  title?: string;
  worktree?: { path: string; branch: string } | null;
  branch?: string | null;
  model?: ModelRef | null;
  permission?: PermissionMode;
  backend?: 'him' | 'acp' | 'cli';
  acpProfileId?: string | null;
  cliProfileId?: string | null;
}

interface SessionStore {
  sessions: AgentSession[];
  activeId: string | null;
  hydrateSessions(sessions: AgentSession[]): void;
  setActive(id: string | null): void;
  createSession(input: CreateSessionInput): AgentSession;
  removeSession(id: string): void;
  updateSession(id: string, updater: (session: AgentSession) => AgentSession): void;
  setStatus(id: string, status: AgentSession['status'], error?: string): void;
  setPermission(id: string, permission: PermissionMode): void;
  setModel(id: string, model: ModelRef | null): void;
  setAcpModels(id: string, models: import('@shared/acp').AcpSessionModels | null): void;
  setAcpVision(id: string, vision: boolean | null): void;
  setPendingApproval(
    id: string,
    pending: { messageId: string; toolCallId: string } | null,
  ): void;
  appendMessage(id: string, message: ChatEntry): void;
  patchMessage(id: string, messageId: string, patch: Partial<ChatEntry>): void;
  removeMessage(id: string, messageId: string): void;
  setToolCall(
    id: string,
    messageId: string,
    callId: string,
    patch: Partial<ToolCallState>,
  ): void;
  addChange(id: string, change: AgentChange): void;
  setChangeStatus(id: string, path: string, status: AgentChange['status']): void;
  upsertArtifact(id: string, artifact: Artifact): void;
  addArtifactComment(id: string, artifactId: string, body: string): string;
  markArtifactCommentSent(id: string, artifactId: string, commentId: string): void;
  startTerminalRun(
    id: string,
    run: Omit<AgentTerminalRun, 'id' | 'running' | 'output' | 'startedAt'>,
  ): string;
  appendTerminalOutput(id: string, runId: string, chunk: string): void;
  finishTerminalRun(id: string, runId: string, code: number | null): void;
  clearTerminalRuns(id: string): void;
  addUsage(
    id: string,
    usage: { input: number; output: number; cost?: number; estimated?: boolean },
  ): void;
  maybeTitle(id: string, prompt: string): void;
  resetConversation(id: string): void;
}

function touch(session: AgentSession): AgentSession {
  return { ...session, updatedAt: Date.now() };
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  sessions: [],
  activeId: null,
  hydrateSessions: (loaded) => {
    set((state) => {
      const byId = new Map(state.sessions.map((session) => [session.id, session]));
      for (const session of loaded) {
        if (!byId.has(session.id)) byId.set(session.id, session);
      }
      const sessions = [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      const activeId = state.activeId || sessions[sessions.length - 1]?.id || null;
      return { sessions, activeId };
    });
  },
  setActive: (id) => set({ activeId: id }),
  createSession: (input) => {
    const now = Date.now();
    const session: AgentSession = {
      id: uid('agent'),
      title: input.title || `Agent ${get().sessions.length + 1}`,
      status: 'queued',
      backend: input.backend || 'him',
      acpProfileId: input.acpProfileId || null,
      cliProfileId: input.cliProfileId || null,
      permission: input.permission || 'review',
      messages: [],
      changes: [],
      artifacts: [],
      terminalRuns: [],
      tokens: { input: 0, output: 0 },
      workspaceRoot: input.workspaceRoot,
      branch: input.branch ?? null,
      worktree: input.worktree || null,
      model: input.model || null,
      createdAt: now,
      updatedAt: now,
      pendingApproval: null,
    };
    set((state) => ({ sessions: [...state.sessions, session], activeId: session.id }));
    return session;
  },
  removeSession: (id) => {
    set((state) => {
      const index = state.sessions.findIndex((session) => session.id === id);
      const sessions = state.sessions.filter((session) => session.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        activeId = sessions[Math.min(index, sessions.length - 1)]?.id || null;
      }
      return { sessions, activeId };
    });
  },
  updateSession: (id, updater) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? touch(updater(session)) : session,
      ),
    }));
  },
  setStatus: (id, status, error) => {
    get().updateSession(id, (session) => ({ ...session, status, error }));
  },
  setPermission: (id, permission) => {
    get().updateSession(id, (session) => ({ ...session, permission }));
  },
  setModel: (id, model) => {
    get().updateSession(id, (session) => ({ ...session, model }));
  },
  setAcpModels: (id, models) => {
    get().updateSession(id, (session) => ({ ...session, acpModels: models }));
  },
  setAcpVision: (id, vision) => {
    get().updateSession(id, (session) => ({ ...session, acpVision: vision }));
  },
  setPendingApproval: (id, pending) => {
    get().updateSession(id, (session) => ({ ...session, pendingApproval: pending }));
  },
  appendMessage: (id, message) => {
    get().updateSession(id, (session) => ({
      ...session,
      messages: [...session.messages, message],
    }));
  },
  patchMessage: (id, messageId, patch) => {
    get().updateSession(id, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      ),
    }));
  },
  removeMessage: (id, messageId) => {
    get().updateSession(id, (session) => ({
      ...session,
      messages: session.messages.filter((message) => message.id !== messageId),
    }));
  },
  setToolCall: (id, messageId, callId, patch) => {
    get().updateSession(id, (session) => ({
      ...session,
      messages: session.messages.map((message) => {
        if (message.id !== messageId || !message.toolCalls) return message;
        return {
          ...message,
          toolCalls: message.toolCalls.map((call) =>
            call.id === callId ? { ...call, ...patch } : call,
          ),
        };
      }),
    }));
  },
  addChange: (id, change) => {
    get().updateSession(id, (session) => {
      const existing = session.changes.find(
        (item) => item.path.toLowerCase() === change.path.toLowerCase(),
      );
      const next: AgentChange = existing
        ? {
            ...existing,
            after: change.after,
            added: change.added,
            removed: change.removed,
            kind: existing.before.trim() === '' ? 'added' : 'modified',
            status: 'pending',
            updatedAt: Date.now(),
          }
        : change;
      const changes = existing
        ? session.changes.map((item) =>
            item.path.toLowerCase() === change.path.toLowerCase() ? next : item,
          )
        : [...session.changes, next];
      return { ...session, changes };
    });
  },
  setChangeStatus: (id, path, status) => {
    get().updateSession(id, (session) => ({
      ...session,
      changes: session.changes.map((change) =>
        change.path.toLowerCase() === path.toLowerCase() ? { ...change, status } : change,
      ),
    }));
  },
  upsertArtifact: (id, artifact) => {
    get().updateSession(id, (session) => {
      const existing = session.artifacts.find(
        (item) => item.title.toLowerCase() === artifact.title.toLowerCase(),
      );
      if (existing) {
        return {
          ...session,
          artifacts: session.artifacts.map((item) =>
            item.id === existing.id
              ? { ...existing, content: artifact.content, updatedAt: Date.now() }
              : item,
          ),
        };
      }
      return { ...session, artifacts: [...session.artifacts, artifact] };
    });
  },
  addArtifactComment: (id, artifactId, body) => {
    const commentId = uid('comment');
    get().updateSession(id, (session) => ({
      ...session,
      artifacts: session.artifacts.map((artifact) =>
        artifact.id === artifactId
          ? {
              ...artifact,
              comments: [
                ...artifact.comments,
                { id: commentId, body, createdAt: Date.now() },
              ],
            }
          : artifact,
      ),
    }));
    return commentId;
  },
  markArtifactCommentSent: (id, artifactId, commentId) => {
    get().updateSession(id, (session) => ({
      ...session,
      artifacts: session.artifacts.map((artifact) =>
        artifact.id === artifactId
          ? {
              ...artifact,
              comments: artifact.comments.map((comment) =>
                comment.id === commentId ? { ...comment, sent: true } : comment,
              ),
            }
          : artifact,
      ),
    }));
  },
  startTerminalRun: (id, run) => {
    const runId = uid('run');
    get().updateSession(id, (session) => ({
      ...session,
      terminalRuns: [
        ...session.terminalRuns,
        { ...run, id: runId, output: '', running: true, startedAt: Date.now() },
      ],
    }));
    return runId;
  },
  appendTerminalOutput: (id, runId, chunk) => {
    get().updateSession(id, (session) => ({
      ...session,
      terminalRuns: session.terminalRuns.map((run) =>
        run.id === runId
          ? { ...run, output: `${run.output}${chunk}`.slice(-160_000) }
          : run,
      ),
    }));
  },
  finishTerminalRun: (id, runId, code) => {
    get().updateSession(id, (session) => ({
      ...session,
      terminalRuns: session.terminalRuns.map((run) =>
        run.id === runId ? { ...run, running: false, code } : run,
      ),
    }));
  },
  clearTerminalRuns: (id) => {
    get().updateSession(id, (session) => ({ ...session, terminalRuns: [] }));
  },
  addUsage: (id, usage) => {
    get().updateSession(id, (session) => ({
      ...session,
      tokens: {
        input: session.tokens.input + usage.input,
        output: session.tokens.output + usage.output,
        cost:
          usage.cost !== undefined
            ? (session.tokens.cost || 0) + usage.cost
            : session.tokens.cost,
        estimated: usage.estimated || session.tokens.estimated,
      },
    }));
  },
  maybeTitle: (id, prompt) => {
    get().updateSession(id, (session) => {
      if (!/^Agent \d+$/.test(session.title)) return session;
      const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 52);
      return { ...session, title: title || session.title };
    });
  },
  resetConversation: (id) => {
    get().updateSession(id, (session) => ({
      ...session,
      messages: [],
      artifacts: [],
      changes: [],
      terminalRuns: [],
      tokens: { input: 0, output: 0 },
      status: 'queued',
      pendingApproval: null,
      error: undefined,
    }));
  },
}));

export function useActiveSession(): AgentSession | null {
  return useSessionStore((state) => {
    if (!state.activeId) return null;
    return state.sessions.find((session) => session.id === state.activeId) || null;
  });
}

export function useSessionCounts(): Record<string, number> {
  return useSessionStore((state) => {
    const counts: Record<string, number> = {
      running: 0,
      waiting: 0,
      queued: 0,
      completed: 0,
    };
    for (const session of state.sessions) {
      if (session.status in counts) counts[session.status] += 1;
    }
    return counts;
  });
}
