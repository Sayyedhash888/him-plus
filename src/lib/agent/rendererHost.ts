import { findModelOption, resolveDefaultModel, useConfigStore, type ModelOption } from '../../store/config';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { useSessionStore } from '../../store/sessions';
import { toast } from '../../store/toast';
import type { AppConfig } from '@shared/types';
import type { AgentSession, PermissionMode } from '../../types';
import { relativize, type WorkspaceContext } from './host';
import { InMemoryAgentHost, type ModelResolver } from './memoryHost';

/**
 * The renderer's `AgentHost`.
 *
 * Everything the agent loop used to reach for directly now goes through the seam,
 * so the loop itself has no store imports and can move to the daemon unchanged.
 * This adapter is where the renderer's specifics live:
 *
 * - **editor state** becomes one `getWorkspaceContext` read;
 * - **model resolution** keeps its existing policy (explicit ref → permission-mode
 *   default → first enabled);
 * - **platform** comes from the preload bridge in the renderer, matching what the
 *   system prompt used to state.
 */

/** The model policy the loop relied on when it read the config store inline. */
export const rendererModelResolver: ModelResolver = (session) => {
  const config: AppConfig | null = useConfigStore.getState().config;
  const explicit = findModelOption(config, session.model);
  if (explicit) return explicit;
  const kind = session.permission === 'plan' ? 'planning' : 'primary';
  return resolveDefaultModel(config, kind);
};

/** Role-based default lookup, for the loop's model fallback path. */
export const rendererFallbackResolver = (
  kind: 'primary' | 'fast' | 'planning',
  config: AppConfig | null,
): ModelOption | null => resolveDefaultModel(config, kind);

function platformValue(): string {
  // `him.platform` is inlined by the preload bridge, so it is absent in tests.
  try {
    const value = (globalThis as { him?: { platform?: string } }).him?.platform;
    if (typeof value === 'string' && value) return value;
  } catch {
    // fall through
  }
  return typeof process !== 'undefined' ? process.platform : 'unknown';
}

function workspaceContext(workspaceRoot: string): WorkspaceContext {
  const core = useCoreStore.getState();
  const editor = useEditorStore.getState();
  const sameWorkspace = core.workspace === workspaceRoot;
  return {
    root: core.workspace || null,
    files: core.workspaceFiles ?? [],
    // Raw absolute paths: the loop relativises them with the same helper both
    // hosts use, so path handling lives in exactly one place.
    //
    // Tabs and the active file only describe the workspace they came from, so a
    // session pointed at another folder gets neither. The comparison is left
    // unnormalised on purpose — it is what the loop always did, and normalising
    // it here would change behaviour for drive-letter case and separator variants.
    openTabs: sameWorkspace ? editor.tabs.map((tab) => tab.path) : [],
    activeFile: sameWorkspace && editor.activePath ? editor.activePath : null,
    branch: core.git?.branch ?? null,
    platform: platformValue(),
  };
}

/**
 * Builds a host over the live renderer stores.
 *
 * Extends the in-memory host rather than re-implementing it: session reads and
 * mutations are delegated to the Zustand store, while this class supplies the
 * renderer-only reads. Keeping one implementation of the mutation contract means
 * the daemon and the renderer cannot drift on things like "do not resurrect a
 * deleted session".
 */
export class RendererAgentHost extends InMemoryAgentHost {
  constructor() {
    super({ modelResolver: rendererModelResolver });
    this.fallbackResolver = rendererFallbackResolver;
  }

  override getSession(sessionId: string): AgentSession | null {
    return (
      useSessionStore.getState().sessions.find((session) => session.id === sessionId) || null
    );
  }

  override getConfig(): AppConfig | null {
    return useConfigStore.getState().config;
  }

  override getWorkspaceContext(workspaceRoot: string): WorkspaceContext {
    return workspaceContext(workspaceRoot);
  }

  override requestSettings(): void {
    useCoreStore.getState().setSettingsOpen(true);
  }

  override notify(kind: 'success' | 'error' | 'info', message: string, title?: string): void {
    toast(kind, message, title);
  }

  override setPermission(sessionId: string, permission: PermissionMode): void {
    useSessionStore.getState().setPermission(sessionId, permission);
  }

  override startTerminalRun(sessionId: string, run: { command: string; cwd: string }): string {
    return useSessionStore.getState().startTerminalRun(sessionId, run);
  }

  override appendTerminalOutput(sessionId: string, runId: string, chunk: string): void {
    useSessionStore.getState().appendTerminalOutput(sessionId, runId, chunk);
  }

  override finishTerminalRun(sessionId: string, runId: string, code: number | null): void {
    useSessionStore.getState().finishTerminalRun(sessionId, runId, code);
  }

  /**
   * Brings the editor's view of a changed file up to date.
   *
   * This is renderer policy, which is why it lives here rather than in the tool:
   * a dirty buffer must be left alone (overwriting it would discard the user's
   * unsaved edits), and a file the agent deleted should lose its tab. The caller
   * states which happened rather than the host inferring it, so there is no
   * stat-after-write race between the daemon and the tool that just ran.
   */
  override refreshAfterFileChange(absPath: string, deleted = false): void {
    const core = useCoreStore.getState();
    core.bumpFs();
    void core.refreshGit();
    void core.refreshWorkspaceFiles();

    const editor = useEditorStore.getState();
    const normalise = (value: string) => value.replaceAll('\\', '/').toLowerCase();
    const tab = editor.tabs.find((item) => normalise(item.path) === normalise(absPath));
    if (!tab) return;
    if (deleted) {
      editor.closeTab(tab.path);
      return;
    }
    // Unsaved edits win: reloading a dirty buffer would discard them. The change
    // is still recorded for diff review, which is what the tool reports.
    if (tab.dirty) return;
    void editor.reloadFromDisk(absPath);
  }

  override maybeTitle(sessionId: string, prompt: string): void {
    useSessionStore.getState().maybeTitle(sessionId, prompt);
  }

  override resetConversation(sessionId: string): void {
    useSessionStore.getState().resetConversation(sessionId);
  }

  /* ---- effects the loop requests but does not wait on ---- */

  override bumpFs(): void {
    useCoreStore.getState().bumpFs();
  }

  override refreshGit(): void {
    void useCoreStore.getState().refreshGit();
  }

  override refreshWorkspaceFiles(): void {
    void useCoreStore.getState().refreshWorkspaceFiles();
  }

  override reloadFromDisk(path: string, force?: boolean): void {
    void useEditorStore.getState().reloadFromDisk(path, force);
  }

  override setLastTerminal(
    value: { command: string; cwd: string; output: string; code: number | null } | null,
  ): void {
    useEditorStore.getState().setLastTerminal(value);
  }

  override readLastTerminal(): {
    command: string;
    cwd: string;
    output: string;
    code: number | null;
  } | null {
    return useEditorStore.getState().lastTerminal;
  }

  override diagnostics(): Array<{
    path: string;
    severity: number | string;
    message: string;
    line?: number;
  }> {
    // `get_diagnostics` reads the live Monaco problem list.
    return useEditorStore.getState().problems.map((problem) => ({
      path: problem.path,
      severity: problem.severity,
      message: problem.message,
      line: problem.line,
      column: problem.column,
      source: problem.source,
    }));
  }

  // The mutation contract is the store's own API, so delegate rather than
  // maintaining a second copy of session state in the renderer.
  override updateSession(
    sessionId: string,
    updater: (session: AgentSession) => AgentSession,
  ): void {
    useSessionStore.getState().updateSession(sessionId, updater);
  }

  override appendMessage(sessionId: string, message: Parameters<InMemoryAgentHost['appendMessage']>[1]): void {
    useSessionStore.getState().appendMessage(sessionId, message);
  }

  override patchMessage(
    sessionId: string,
    messageId: string,
    patch: Parameters<InMemoryAgentHost['patchMessage']>[2],
  ): void {
    useSessionStore.getState().patchMessage(sessionId, messageId, patch);
  }

  override removeMessage(sessionId: string, messageId: string): void {
    useSessionStore.getState().removeMessage(sessionId, messageId);
  }

  override setStatus(
    sessionId: string,
    status: AgentSession['status'],
    error?: string,
  ): void {
    useSessionStore.getState().setStatus(sessionId, status, error);
  }

  override setPendingApproval(
    sessionId: string,
    pending: { messageId: string; toolCallId: string } | null,
  ): void {
    useSessionStore.getState().setPendingApproval(sessionId, pending);
  }

  override setToolCall(
    sessionId: string,
    messageId: string,
    callId: string,
    patch: Parameters<InMemoryAgentHost['setToolCall']>[3],
  ): void {
    useSessionStore.getState().setToolCall(sessionId, messageId, callId, patch);
  }

  override addUsage(
    sessionId: string,
    usage: { input: number; output: number; cost?: number; estimated?: boolean },
  ): void {
    useSessionStore.getState().addUsage(sessionId, usage);
  }

  override addChange(
    sessionId: string,
    change: Parameters<InMemoryAgentHost['addChange']>[1],
  ): void {
    useSessionStore.getState().addChange(sessionId, change);
  }

  override upsertArtifact(
    sessionId: string,
    artifact: Parameters<InMemoryAgentHost['upsertArtifact']>[1],
  ): void {
    useSessionStore.getState().upsertArtifact(sessionId, artifact);
  }
}

/** Convenience for the app bootstrap. */
export function createRendererAgentHost(): RendererAgentHost {
  return new RendererAgentHost();
}
