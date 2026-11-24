import type { ModelOption } from '@shared/types';
import type { AppConfig } from '@shared/types';
import type { AgentSession, AgentChange, Artifact, ChatEntry, ToolCallState } from '../../types';
import type { AgentHost, WorkspaceContext } from './host';
import type { PermissionMode } from '../../types';

/** Decides which model a session runs on. Injected so the host has no store dependency. */
export type ModelResolver = (session: AgentSession, config: AppConfig | null) => ModelOption | null;

/**
 * An in-memory `AgentHost`.
 *
 * Two jobs. In tests it lets the agent loop be driven with no renderer, no
 * Electron and no filesystem. In the daemon it is the starting point for the real
 * host: the same shape, backed by whatever persistence the daemon owns.
 *
 * It is deliberately strict about a few things the renderer's stores were loose
 * about, because the loop relies on them:
 *
 * - `updateSession` must not resurrect a deleted session.
 * - `setToolCall` must not invent a message that does not exist.
 * - `setStatus` records the error alongside the status so a failed run is
 *   diagnosable rather than just "error".
 *
 * Each of those would be silent data corruption in a long-lived daemon holding
 * several sessions at once, so they throw or no-op rather than half-apply.
 */
export class InMemoryAgentHost implements AgentHost {
  private readonly sessions = new Map<string, AgentSession>();
  private config: AppConfig | null = null;
  private workspace: WorkspaceContext = {
    root: null,
    files: [],
    openTabs: [],
    activeFile: null,
    branch: null,
    platform: typeof process !== 'undefined' ? process.platform : 'unknown',
  };
  /** Every mutation, in order — lets a test assert what the loop actually did. */
  readonly applied: Array<{ kind: string; sessionId: string; detail?: unknown }> = [];
  private readonly modelResolver: ModelResolver | null;

  constructor(init: {
    sessions?: AgentSession[];
    config?: AppConfig | null;
    workspace?: Partial<WorkspaceContext>;
    /**
     * Supplied by whichever host owns model policy. Optional so a test can drive
     * the loop without constructing a provider config; `resolveModel` then returns
     * null, which the loop treats as "no model selected".
     */
    modelResolver?: ModelResolver;
  } = {}) {
    for (const session of init.sessions ?? []) this.sessions.set(session.id, session);
    this.config = init.config ?? null;
    if (init.workspace) this.workspace = { ...this.workspace, ...init.workspace };
    this.modelResolver = init.modelResolver ?? null;
  }

  /* ---- reads ---- */

  getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Test seam: sessions currently held, for assertions. */
  allSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  getConfig(): AppConfig | null {
    return this.config;
  }

  setConfig(config: AppConfig | null): void {
    this.config = config;
  }

  setWorkspace(workspace: Partial<WorkspaceContext>): void {
    this.workspace = { ...this.workspace, ...workspace };
  }

  resolveModel(session: AgentSession): ModelOption | null {
    // Delegated: model policy (explicit ref → permission-mode default → first
    // enabled) lives with the host that owns the config, not in the loop.
    return this.modelResolver ? this.modelResolver(session, this.config) : null;
  }

  /**
   * Default model for a role. `fallbackResolver` mirrors the session resolver for
   * hosts that want role-based lookups; without it this reports "no model" rather
   * than guessing, which the loop treats as "no fallback available".
   */
  fallbackResolver: ((kind: 'primary' | 'fast' | 'planning', config: AppConfig | null) => ModelOption | null) | null =
    null;

  resolveModelByKind(kind: 'primary' | 'fast' | 'planning'): ModelOption | null {
    return this.fallbackResolver ? this.fallbackResolver(kind, this.config) : null;
  }

  getWorkspaceContext(workspaceRoot: string): WorkspaceContext {
    // Tabs and the active file only describe the workspace they came from.
    if (this.workspace.root && this.workspace.root !== workspaceRoot) {
      return { ...this.workspace, root: workspaceRoot, openTabs: [], activeFile: null };
    }
    return this.workspace;
  }

  /** Counts requests rather than opening anything; a headless host has no UI. */
  readonly settingsRequests: number[] = [];

  requestSettings(): void {
    this.settingsRequests.push(Date.now());
    this.applied.push({ kind: 'requestSettings', sessionId: '' });
  }

  /** Notifications, captured instead of rendered. */
  readonly notifications: Array<{ kind: string; message: string; title?: string }> = [];

  notify(kind: 'success' | 'error' | 'info', message: string, title?: string): void {
    this.notifications.push({ kind, message, title });
    this.applied.push({ kind: 'notify', sessionId: '', detail: { kind, message } });
  }

  /* ---- effects ----
   * A headless host has no UI to refresh, so these are no-ops. They are still
   * recorded (and counted) so a test can assert the loop asked for them rather
   * than silently doing nothing.
   */

  readonly effects: Array<{ kind: string; detail?: unknown }> = [];

  bumpFs(): void {
    this.effects.push({ kind: 'bumpFs' });
  }

  refreshGit(): void {
    this.effects.push({ kind: 'refreshGit' });
  }

  refreshWorkspaceFiles(): void {
    this.effects.push({ kind: 'refreshWorkspaceFiles' });
  }

  reloadFromDisk(path: string, force?: boolean): void {
    this.effects.push({ kind: 'reloadFromDisk', detail: { path, force } });
  }

  setLastTerminal(
    value: { command: string; cwd: string; output: string; code: number | null } | null,
  ): void {
    this.terminalResult = value;
    this.effects.push({ kind: 'setLastTerminal', detail: value });
  }

  /** Last terminal result, so `@terminal` mentions can be exercised headlessly. */
  terminalResult: { command: string; cwd: string; output: string; code: number | null } | null = null;

  readLastTerminal(): { command: string; cwd: string; output: string; code: number | null } | null {
    return this.terminalResult;
  }

  /**
   * Diagnostics supplied by whatever wires the host to a language server. Left
   * undefined by default so a headless host reports "unavailable" instead of
   * "no problems", which the model would read as "this file is clean".
   */
  diagnosticSource: (() => Array<{
    path: string;
    severity: number | string;
    message: string;
    line?: number;
    column?: number;
    source?: string;
  }>) | null = null;

  /**
   * Absent when no language-server source is wired. That is deliberately a
   * different outcome from an empty array: the tool reports "unavailable"
   * rather than "no problems", so a broken file is never described as clean.
   */
  hasDiagnostics(): boolean {
    return this.diagnosticSource !== null;
  }

  diagnostics(): Array<{
    path: string;
    severity: number | string;
    message: string;
    line?: number;
    column?: number;
    source?: string;
  }> {
    return this.diagnosticSource ? this.diagnosticSource() : [];
  }

  /* ---- writes ---- */

  updateSession(sessionId: string, updater: (session: AgentSession) => AgentSession): void {
    const current = this.sessions.get(sessionId);
    if (!current) return; // never resurrect a deleted session
    const next = updater(current);
    this.sessions.set(sessionId, { ...next, updatedAt: Date.now() });
    this.applied.push({ kind: 'updateSession', sessionId });
  }

  appendMessage(sessionId: string, message: ChatEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      messages: [...session.messages, message],
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'appendMessage', sessionId, detail: message.id });
  }

  patchMessage(sessionId: string, messageId: string, patch: Partial<ChatEntry>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      messages: session.messages.map((entry) =>
        entry.id === messageId ? { ...entry, ...patch } : entry,
      ),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'patchMessage', sessionId, detail: messageId });
  }

  removeMessage(sessionId: string, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      messages: session.messages.filter((entry) => entry.id !== messageId),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'removeMessage', sessionId, detail: messageId });
  }

  setStatus(sessionId: string, status: AgentSession['status'], error?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      status,
      ...(error === undefined ? {} : { error }),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'setStatus', sessionId, detail: { status, error } });
  }

  setPermission(sessionId: string, permission: PermissionMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, { ...session, permission, updatedAt: Date.now() });
    this.applied.push({ kind: 'setPermission', sessionId, detail: permission });
  }

  /**
   * Titles a session from its first prompt.
   *
   * Mirrors the store exactly: only a session still on its generated
   * `Agent <n>` name is retitled, and the title is capped at 52 characters. The
   * loop calls this on every prompt, so an unconditional rename would churn the
   * title on each follow-up.
   */
  maybeTitle(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!/^Agent \d+$/.test(session.title)) return;
    const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 52);
    if (!title) return;
    this.sessions.set(sessionId, { ...session, title, updatedAt: Date.now() });
    this.applied.push({ kind: 'maybeTitle', sessionId, detail: title });
  }

  /** Matches the store: resets the transcript and returns the session to 'queued'. */
  resetConversation(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      messages: [],
      artifacts: [],
      changes: [],
      terminalRuns: [],
      tokens: { input: 0, output: 0 },
      status: 'queued',
      pendingApproval: null,
      error: undefined,
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'resetConversation', sessionId });
  }

  /**
   * Terminal-run bookkeeping.
   *
   * A headless host has no UI to stream into, so it records the run and its
   * output as data. The id is returned because the caller correlates exec events
   * with it — this is the one host method that cannot be fire-and-forget.
   */
  private terminalCounter = 0;

  startTerminalRun(sessionId: string, run: { command: string; cwd: string }): string {
    const runId = `run-${++this.terminalCounter}`;
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        terminalRuns: [
          ...session.terminalRuns,
          {
            id: runId,
            command: run.command,
            cwd: run.cwd,
            output: '',
            code: undefined,
            running: true,
            startedAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      });
    }
    this.applied.push({ kind: 'startTerminalRun', sessionId, detail: runId });
    return runId;
  }

  appendTerminalOutput(sessionId: string, runId: string, chunk: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      terminalRuns: session.terminalRuns.map((entry) =>
        entry.id === runId ? { ...entry, output: entry.output + chunk } : entry,
      ),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'appendTerminalOutput', sessionId, detail: { runId } });
  }

  finishTerminalRun(sessionId: string, runId: string, code: number | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      terminalRuns: session.terminalRuns.map((entry) =>
        entry.id === runId ? { ...entry, running: false, code } : entry,
      ),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'finishTerminalRun', sessionId, detail: { runId, code } });
  }

  /**
   * No-op bookkeeping for a file the agent changed.
   *
   * A headless host has no editor buffer to reload, and — importantly — must not
   * pretend it does. The renderer's richer behaviour (skip a dirty buffer, close a
   * deleted file's tab) lives in `RendererAgentHost`.
   */
  refreshAfterFileChange(absPath: string, deleted = false): void {
    this.effects.push({ kind: 'refreshAfterFileChange', detail: { absPath, deleted } });
  }

  setPendingApproval(
    sessionId: string,
    pending: { messageId: string; toolCallId: string } | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, { ...session, pendingApproval: pending, updatedAt: Date.now() });
    this.applied.push({ kind: 'setPendingApproval', sessionId, detail: pending });
  }

  setToolCall(
    sessionId: string,
    messageId: string,
    callId: string,
    patch: Partial<ToolCallState>,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const message = session.messages.find((entry) => entry.id === messageId);
    // A tool-call update for a message that no longer exists is a bug upstream;
    // inventing the message would hide it.
    if (!message) return;
    this.sessions.set(sessionId, {
      ...session,
      messages: session.messages.map((entry) =>
        entry.id === messageId
          ? {
              ...entry,
              toolCalls: (entry.toolCalls ?? []).map((call) =>
                call.id === callId ? { ...call, ...patch } : call,
              ),
            }
          : entry,
      ),
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'setToolCall', sessionId, detail: { messageId, callId, patch } });
  }

  addUsage(
    sessionId: string,
    usage: { input: number; output: number; cost?: number; estimated?: boolean },
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const tokens = session.tokens ?? { input: 0, output: 0 };
    this.sessions.set(sessionId, {
      ...session,
      tokens: {
        input: tokens.input + (usage.input || 0),
        output: tokens.output + (usage.output || 0),
        cost: (tokens.cost ?? 0) + (usage.cost ?? 0),
        estimated: usage.estimated ?? tokens.estimated,
      },
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'addUsage', sessionId, detail: usage });
  }

  addChange(sessionId: string, change: AgentChange): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const existing = session.changes.find((entry) => entry.path === change.path);
    this.sessions.set(sessionId, {
      ...session,
      changes: existing
        ? session.changes.map((entry) => (entry.path === change.path ? change : entry))
        : [...session.changes, change],
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'addChange', sessionId, detail: change.path });
  }

  upsertArtifact(sessionId: string, artifact: Artifact): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const existing = session.artifacts.find((entry) => entry.id === artifact.id);
    this.sessions.set(sessionId, {
      ...session,
      artifacts: existing
        ? session.artifacts.map((entry) => (entry.id === artifact.id ? artifact : entry))
        : [...session.artifacts, artifact],
      updatedAt: Date.now(),
    });
    this.applied.push({ kind: 'upsertArtifact', sessionId, detail: artifact.id });
  }
}
