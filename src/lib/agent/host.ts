import type { ModelOption } from '@shared/types';
import type {
  AgentSession,
  AgentChange,
  Artifact,
  ChatEntry,
  PermissionMode,
  ToolCallState,
} from '../../types';

/**
 * The seam between the agent loop and whatever is hosting it.
 *
 * `src/lib/agent/runtime.ts` used to reach directly into four Zustand stores
 * (`useSessionStore`, `useCoreStore`, `useEditorStore`, `useConfigStore`). That
 * pinned the loop to the Electron renderer: it could not run in the daemon, and it
 * died whenever a window reloaded.
 *
 * The interface below is exactly the surface the loop needs, no more. Two design
 * rules keep it portable:
 *
 * 1. **Narrow, purpose-shaped reads.** The loop never asks for "editor state"; it
 *    asks for the workspace context it needs to build a system prompt. The daemon
 *    can answer from files on disk; the renderer answers from its stores.
 * 2. **Writes are fire-and-forget and void.** The loop never consumes a return
 *    value from a mutation, so a host may persist synchronously (renderer) or
 *    synchronously-into-a-queue (daemon) without changing loop semantics.
 *
 * Everything is synchronous on purpose: the loop runs synchronously between
 * `await` points, and session state must be readable at any point in that stretch.
 * Hosts that need to load state asynchronously do it at startup, before the loop
 * runs.
 */

/** Context the loop needs to build a system prompt for one workspace. */
export interface WorkspaceContext {
  /**
   * The workspace this context describes, and whether it matches a session's.
   * `openTabs` and `activeFile` are only meaningful for this root, so the host
   * gates them here rather than making every caller re-derive the comparison.
   */
  root: string | null;
  /** Workspace-relative file paths, for the prompt's file map. */
  files: string[];
  /**
   * Absolute paths of open editor tabs, or empty when they belong to another
   * workspace. Raw rather than workspace-relative: the loop relativises with the
   * same helper for every host, so path handling lives in one place.
   */
  openTabs: string[];
  /** Absolute path of the active editor, or null. Relativised by the loop. */
  activeFile: string | null;
  /** Current git branch, used as a fallback when the session has none. */
  branch: string | null;
  /** `process.platform` value; the prompt states it, so it cannot be inlined. */
  platform: string;
}

/*
 * One object, not two interfaces. The effects below were declared separately
 * when only the renderer implemented them; tools.ts reaches for them through
 * `getAgentHost()`, so keeping them off `AgentHost` would force every caller to
 * cast. They stay OPTIONAL because a headless daemon legitimately cannot do
 * some of them (it has no editor buffers and no language server) — and the
 * difference between "cannot" and "nothing to report" is load-bearing for
 * `diagnostics`.
 */
export interface AgentHost extends AgentHostEffects {
  /** Sessions known to this host; the loop looks up by id. */
  getSession(sessionId: string): AgentSession | null;

  /** Current provider config, or null when none is loaded. */
  getConfig(): unknown;

  /**
   * Model resolution for a session. Kept on the host because it depends on config
   * shape and platform policy the loop should not know about.
   */
  resolveModel(session: AgentSession): ModelOption | null;

  /**
   * The configured default model for one role. The loop uses this to fall back to
   * a different model when the current one fails, so it needs the same policy the
   * host already applies — not a re-implementation against a raw config object.
   */
  resolveModelByKind(kind: 'primary' | 'fast' | 'planning'): ModelOption | null;

  /** Editor/workspace state for prompt building. */
  getWorkspaceContext(workspaceRoot: string): WorkspaceContext;

  /**
   * Asks the host to surface its model/provider settings.
   *
   * The loop calls this when it cannot resolve a model, which is a user-fixable
   * configuration problem. A headless host may log instead of opening a dialog;
   * the loop must not care which.
   */
  requestSettings(): void;

  /**
   * User-facing notification, replacing the loop's 20 `toast()` calls.
   *
   * A daemon has no toast stack, so this must be a host concern rather than a
   * fifth store the loop imports.
   */
  notify(kind: 'success' | 'error' | 'info', message: string, title?: string): void;

  /* ---- session mutations; all fire-and-forget ---- */
  updateSession(sessionId: string, updater: (session: AgentSession) => AgentSession): void;
  appendMessage(sessionId: string, message: ChatEntry): void;
  patchMessage(sessionId: string, messageId: string, patch: Partial<ChatEntry>): void;
  removeMessage(sessionId: string, messageId: string): void;
  setStatus(sessionId: string, status: AgentSession['status'], error?: string): void;
  setPermission(sessionId: string, permission: PermissionMode): void;
  setPendingApproval(
    sessionId: string,
    pending: { messageId: string; toolCallId: string } | null,
  ): void;
  setToolCall(
    sessionId: string,
    messageId: string,
    callId: string,
    patch: Partial<ToolCallState>,
  ): void;
  addUsage(
    sessionId: string,
    usage: { input: number; output: number; cost?: number; estimated?: boolean },
  ): void;
  addChange(sessionId: string, change: AgentChange): void;
  upsertArtifact(sessionId: string, artifact: Artifact): void;
  /** Derives a session title from its first prompt, if the host wants one. */
  maybeTitle(sessionId: string, prompt: string): void;
  /** Clears a transcript while keeping the session itself. */
  resetConversation(sessionId: string): void;

  /**
   * Records a started terminal command and returns its run id.
   *
   * The single mutation on this interface whose return value the loop consumes —
   * `run_terminal_command` needs the id to correlate `him.exec.onChunk` events and
   * to finish the run. It must therefore be synchronous. Everything else here is
   * fire-and-forget deliberately: a host may queue those.
   */
  startTerminalRun(
    sessionId: string,
    run: { command: string; cwd: string },
  ): string;
  appendTerminalOutput(sessionId: string, runId: string, chunk: string): void;
  finishTerminalRun(sessionId: string, runId: string, code: number | null): void;

  /**
   * The agent changed a file on disk; bring the host's view of it up to date.
   *
   * One call rather than separate "bump fs / refresh git / reload the tab" steps,
   * because the useful part is host-specific: the renderer reloads a clean editor
   * buffer, leaves a dirty one alone, and closes the tab when the file is gone.
   * None of that belongs in a tool implementation. `deleted` states which happened
   * rather than the host inferring it, so there is no stat-after-write race.
   */
  refreshAfterFileChange(absPath: string, deleted?: boolean): void;
}

/**
 * Secondary effects the loop requests but does not wait on.
 *
 * Kept separate from `AgentHost` so a host can implement the session contract
 * without also owning workspace refresh. Every method is optional: the loop
 * treats a missing effect as a no-op, which is the correct behaviour for a
 * headless daemon that has no UI to refresh.
 */
export interface AgentHostEffects {
  /** The filesystem changed outside the editor; re-scan. */
  bumpFs?(): void;
  /** Git state changed; re-read status. */
  refreshGit?(): void;
  /** Workspace file list is stale; rebuild it. */
  refreshWorkspaceFiles?(): void;
  /**
   * After writing a file the agent had open, refresh that editor buffer.
   * `force` reloads even when the buffer looks clean.
   */
  reloadFromDisk?(path: string, force?: boolean): void;
  /** The last terminal command/result, for the `@terminal` mention. */
  setLastTerminal?(
    value: { command: string; cwd: string; output: string; code: number | null } | null,
  ): void;
  /** The last run terminal command, read back by the `@terminal` mention. */
  readLastTerminal?(): { command: string; cwd: string; output: string; code: number | null } | null;

  /**
   * Live editor diagnostics, for the `get_diagnostics` tool.
   *
   * Only a host wired to a language server can answer this; a headless daemon
   * cannot derive diagnostics from files on disk. The tool must therefore report
   * "unavailable in this host" rather than "no diagnostics", because returning an
   * empty list would tell the model a broken file is clean.
   *
   * `severity` is passed through as-is: the renderer uses Monaco's numeric enum.
   */
  diagnostics?(): Array<{
    path: string;
    /** Monaco's numeric MarkerSeverity; passed through untyped on purpose. */
    severity: number | string;
    message: string;
    line?: number;
    column?: number;
    source?: string;
  }>;
}

let activeHost: AgentHost | null = null;

/**
 * Installs the host. The renderer calls this once at boot; the daemon installs its
 * own. Throws if the loop runs before a host exists, which is a programming error
 * rather than a recoverable state.
 */
export function configureAgentHost(host: AgentHost): void {
  activeHost = host;
}

export function tryGetAgentHost(): AgentHost | null {
  return activeHost;
}

export function getAgentHost(): AgentHost {
  if (!activeHost) {
    throw new Error(
      'The agent host has not been configured. Call configureAgentHost() before running the agent loop.',
    );
  }
  return activeHost;
}

/** Test helper: drops the installed host so suites do not leak into each other. */
export function resetAgentHost(): void {
  activeHost = null;
}

/**
 * Builds the context the loop needs from coarse host reads.
 *
 * `files` (workspace listing) and `openTabs` (editor tabs) both come from outside
 * the loop. This helper applies the one rule that was previously implicit in the
 * loop and easy to get wrong: tab and active-file information is only meaningful
 * for the workspace the session actually targets.
 */
export function relativize(
  workspaceRoot: string,
  targetPath: string,
): string {
  const normalise = (value: string) => value.replace(/\\/g, '/');
  const root = normalise(workspaceRoot).replace(/\/+$/, '');
  const target = normalise(targetPath);
  if (!root) return target;
  if (target === root) return '';
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1);
  return target;
}
