import type { AgentSession } from '../types';
import { cleanErrorMessage, him } from './bridge';
import { applyCodeToEditor } from './editorBridge';
import { basename, relativeTo, uid } from './utils';
import { useAgentUiStore } from '../store/agentUi';
import { useConfigStore } from '../store/config';
import { useCoreStore } from '../store/core';
import { useEditorStore } from '../store/editor';
import { useSessionStore } from '../store/sessions';
import { useCliStore } from '../store/cliSessions';
import { toast } from '../store/toast';
import { sendPrompt, stopAgent } from './agent/runtime';
import { hydrateChats, startChatSync } from './chatSync';
import { summarizeSessionLocally } from './agent/context';
import { buildHandoffPrompt, handoffContextFromSession } from './agent/handoff';
import { startLspBridge } from './lsp';
import { startWorkspaceWatcher } from './watcher';

let bootPromise: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      await useConfigStore.getState().init();
      if (!useConfigStore.getState().config) {
        throw new Error(useConfigStore.getState().loadError || 'Could not load configuration.');
      }
      const config = useConfigStore.getState().config!;
      useCoreStore.getState().setMode(config.prefs.mode);
      await hydrateChats();
      startChatSync();
      startLspBridge();
      const launchWorkspace = await him.app.initialWorkspace();
      const targetWorkspace = launchWorkspace || config.lastWorkspace;
      if (targetWorkspace) {
        await openWorkspace(targetWorkspace, { silent: true, remember: true });
      }
      useCoreStore.getState().setBooted(true);
    } catch (error) {
      useCoreStore.getState().setBooted(true, cleanErrorMessage(error));
    }
  })();
  return bootPromise;
}

export function switchMode(mode: 'agent' | 'ide'): void {
  useCoreStore.getState().setMode(mode);
}

export function toggleMode(): void {
  switchMode(useCoreStore.getState().mode === 'agent' ? 'ide' : 'agent');
}

export async function openWorkspace(
  targetPath?: string,
  options: { silent?: boolean; remember?: boolean } = {},
): Promise<void> {
  let target = targetPath;
  if (!target) {
    target = (await him.dialog.openFolder()) || undefined;
    if (!target) return;
  }
  const editor = useEditorStore.getState();
  if (!options.silent && editor.tabs.some((tab) => tab.dirty)) {
    const proceed = await him.dialog.confirm({
      title: 'Switch workspace?',
      message: 'You have unsaved editor buffers.',
      detail: 'Switch anyway and discard the unsaved buffers? Files already on disk are kept.',
      confirmLabel: 'Switch workspace',
      danger: true,
    });
    if (!proceed) return;
  }
  const restrict = useConfigStore.getState().config?.prefs.restrictFileAccess !== false;
  const previousWorkspace = useCoreStore.getState().workspace;
  try {
    // Point the guard at the new folder BEFORE validating it, otherwise the
    // restriction blocks reading the folder the user just picked.
    await him.fs.setWorkspaceAccess(target, restrict);
    await him.fs.readDir(target);
  } catch (error) {
    try {
      await him.fs.setWorkspaceAccess(previousWorkspace || null, restrict);
    } catch {
      // ignore restore failure
    }
    toast('error', cleanErrorMessage(error), 'Open workspace failed');
    return;
  }
  editor.closeAll();
  const core = useCoreStore.getState();
  core.setWorkspace(target);
  try {
    await him.fs.setWorkspaceAccess(target, restrict);
  } catch {
    // Older builds may not expose the guard; file tools still enforce containment.
  }
  if (options.remember !== false) {
    useConfigStore.getState().setLastWorkspace(target);
  }
  await Promise.all([core.refreshGit(), core.refreshWorkspaceFiles()]);
  void startWorkspaceWatcher(target);
  if (useConfigStore.getState().config?.copilot?.enabled) {
    void him.copilot.setRoot(target).catch(() => undefined);
  }
  if (!options.silent) {
    toast('success', `Opened ${basename(target)}.`, 'Workspace ready');
  }
}

export async function createAgent(
  options: { isolated?: boolean; acpProfileId?: string; cliProfileId?: string } = {},
): Promise<AgentSession | null> {
  const core = useCoreStore.getState();
  if (!core.workspace) {
    toast('error', 'Open a folder before spawning an agent.', 'No workspace');
    return null;
  }
  let backend: AgentSession['backend'] = 'him';
  let acpProfileId: string | null = null;
  let cliProfileId: string | null = null;
  let title = '';
  if (options.cliProfileId) {
    const profile = useConfigStore
      .getState()
      .config?.cliAgents.find((item) => item.id === options.cliProfileId);
    if (!profile || !profile.enabled || !profile.command.trim()) {
      toast(
        'error',
        'This CLI profile is disabled or has no launch command. Check Settings → Integrations → CLI agents.',
        'CLI profile unavailable',
      );
      return null;
    }
    backend = 'cli';
    cliProfileId = profile.id;
    title = profile.name;
  }
  if (options.acpProfileId) {
    const profile = useConfigStore
      .getState()
      .config?.acpAgents.find((item) => item.id === options.acpProfileId);
    if (!profile || !profile.enabled || !profile.command.trim()) {
      toast(
        'error',
        'This ACP profile is disabled or has no launch command. Check Settings → Integrations.',
        'ACP profile unavailable',
      );
      return null;
    }
    backend = 'acp';
    acpProfileId = profile.id;
    title = profile.name;
  }
  let gitStatus = core.git;
  if (!gitStatus) {
    try {
      gitStatus = await him.git.status(core.workspace);
      useCoreStore.getState().setGit(gitStatus);
    } catch {
      gitStatus = null;
    }
  }
  const existing = useSessionStore.getState().sessions;
  const number = existing.length + 1;
  let workspaceRoot = core.workspace;
  let worktree: { path: string; branch: string } | null = null;
  let branch = gitStatus?.branch || null;
  if (options.isolated) {
    if (!gitStatus?.isRepo) {
      toast('error', 'Worktree isolation requires a git repository.', 'Not a git repository');
      return null;
    }
    try {
      const created = await him.git.worktree(core.workspace, `agent-${number}`);
      worktree = { path: created.path, branch: created.branch };
      workspaceRoot = created.path;
      branch = created.branch;
      toast(
        'info',
        `Isolated from HEAD on ${created.branch}. Uncommitted changes are not carried into the worktree.`,
        'Worktree created',
      );
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Worktree creation failed');
      return null;
    }
  }
  const session = useSessionStore.getState().createSession({
    workspaceRoot,
    title: title || `Agent ${number}`,
    worktree,
    branch,
    permission: 'review',
    model: null,
    backend,
    acpProfileId,
    cliProfileId,
  });
  useAgentUiStore.getState().setTab('artifacts');
  return session;
}

/**
 * Local context compaction for terminal-CLI sessions (native agents have
 * compactAgent in the runtime). Keeps the last few mirrored turns and replaces
 * older ones with a local summary, so long PTY sessions stay persistable/usable.
 */
export function compactCliConversation(
  sessionId: string,
  options: { silent?: boolean } = {},
): boolean {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session || session.backend !== 'cli') return false;
  const conversational = session.messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') && !message.streaming,
  );
  if (conversational.length < 6) {
    if (!options.silent) {
      toast('info', 'This CLI conversation is already compact.', 'Context');
    }
    return false;
  }
  const summaryEntry = {
    id: uid('msg'),
    role: 'system' as const,
    content: summarizeSessionLocally(session),
    createdAt: Date.now(),
    compactionNote: true,
  };
  const kept = conversational.slice(-6);
  useSessionStore.getState().updateSession(sessionId, (current) => ({
    ...current,
    messages: [summaryEntry, ...kept],
  }));
  if (!options.silent) {
    toast(
      'success',
      'Earlier CLI turns were summarized locally. The terminal transcript stays in the PTY.',
      'Context compacted',
    );
  }
  return true;
}

export async function createSessionCheckpoint(
  sessionId: string,
  label = 'Checkpoint',
): Promise<import('@shared/types').CheckpointInfo | null> {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  try {
    const info = await him.checkpoint.create(sessionId, session.workspaceRoot, label);
    toast('success', `Checkpoint “${info.label}” saved (${info.fileCount} files).`, 'Checkpoint');
    return info;
  } catch (error) {
    toast('info', cleanErrorMessage(error), 'Checkpoint unavailable');
    return null;
  }
}

/**
 * Hands a finished session's work to a review/continuation agent: creates a
 * git checkpoint, packages context + changed files, then sends the handoff prompt
 * to a new or existing session.
 */
export async function handoffAgent(
  sourceId: string,
  target: 'new' | string,
  instruction: string,
): Promise<string | null> {
  const source = useSessionStore.getState().sessions.find((item) => item.id === sourceId);
  if (!source) return null;
  let checkpointLabel: string | null = null;
  try {
    const checkpoint = await him.checkpoint.create(
      source.id,
      source.workspaceRoot,
      `Handoff from ${source.title}`,
    );
    checkpointLabel = checkpoint.label;
  } catch {
    checkpointLabel = null;
  }
  const context = handoffContextFromSession(source);
  const prompt = buildHandoffPrompt({
    sourceTitle: source.title,
    request: context.request,
    summary: context.summary,
    changedPaths: context.changedPaths,
    checkpointLabel,
    instruction,
  });

  let targetSession: AgentSession | null = null;
  if (target === 'new') {
    targetSession = await createAgent({});
    if (targetSession) renameAgent(targetSession.id, `Review: ${source.title}`);
  } else {
    targetSession = useSessionStore.getState().sessions.find((item) => item.id === target) || null;
  }
  if (!targetSession) {
    toast('error', 'Could not create or find the target agent session.', 'Handoff failed');
    return null;
  }
  useSessionStore.getState().setActive(targetSession.id);
  try {
    await sendPrompt(targetSession.id, prompt);
    toast(
      'success',
      `Handed off to “${targetSession.title}”${checkpointLabel ? ' with a checkpoint' : ''}.`,
      'Handoff',
    );
    return targetSession.id;
  } catch (error) {
    toast('error', cleanErrorMessage(error), 'Handoff failed');
    return null;
  }
}

export async function removeAgent(sessionId: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session) return;
  if (session.status === 'running' || session.status === 'waiting') {
    const proceed = await him.dialog.confirm({
      title: 'Stop and remove agent?',
      message: `"${session.title}" is still working.`,
      detail: 'Stopping removes the agent from this window. File changes already on disk are not reverted.',
      confirmLabel: 'Stop and remove',
      danger: true,
    });
    if (!proceed) return;
  }
  stopAgent(sessionId);
  void him.acp.dispose(sessionId);
  if (session.backend === 'cli') {
    await him.cliAgent.stop(sessionId).catch(() => undefined);
    useCliStore.getState().remove(sessionId);
  }
  useSessionStore.getState().removeSession(sessionId);
}

/** Stops a CLI-agent PTY and marks the session stopped. */
export async function stopCliAgentSession(sessionId: string): Promise<void> {
  await him.cliAgent.stop(sessionId).catch(() => undefined);
  useCliStore.getState().setStatus(sessionId, 'exited', null);
  useSessionStore.getState().setStatus(sessionId, 'stopped');
}

export function renameAgent(sessionId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  useSessionStore.getState().updateSession(sessionId, (session) => ({
    ...session,
    title: trimmed,
  }));
}

export function cyclePermission(current: AgentSession['permission']): AgentSession['permission'] {
  if (current === 'plan') return 'review';
  if (current === 'review') return 'auto';
  return 'plan';
}

export async function acceptChange(sessionId: string, path: string): Promise<void> {
  useSessionStore.getState().setChangeStatus(sessionId, path, 'accepted');
  toast('success', `${path} accepted.`, 'Change kept');
}

export function acceptAllChanges(sessionId: string): void {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session) return;
  for (const change of session.changes) {
    useSessionStore.getState().setChangeStatus(sessionId, change.path, 'accepted');
  }
  toast('success', 'All pending changes marked as accepted.', 'Review complete');
}

export async function revertChange(sessionId: string, path: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  const change = session?.changes.find((item) => item.path === path);
  if (!session || !change) return;
  try {
    const exists = await him.fs.exists(change.absPath);
    if (change.kind === 'added') {
      if (exists) await him.fs.trash(change.absPath);
    } else {
      if (!exists) {
        await him.fs.writeFile(change.absPath, change.before);
      } else {
        await him.fs.writeFile(change.absPath, change.before);
      }
    }
    useSessionStore.getState().setChangeStatus(sessionId, change.path, 'reverted');
    const editor = useEditorStore.getState();
    const tab = editor.tabs.find(
      (item) => item.path.replaceAll('\\', '/').toLowerCase() === change.absPath.toLowerCase(),
    );
    if (change.kind === 'added') {
      if (tab) editor.closeTab(tab.path);
    } else if (tab) {
      await editor.reloadFromDisk(change.absPath, true);
    }
    const core = useCoreStore.getState();
    core.bumpFs();
    void core.refreshGit();
    void core.refreshWorkspaceFiles();
    toast('success', `${path} reverted to its previous content.`, 'File reverted');
  } catch (error) {
    toast('error', cleanErrorMessage(error), 'Revert failed');
  }
}

/**
 * Reverts every pending change in a session back to its pre-agent content.
 * Useful as a session-level "undo all" after reviewing a mission.
 */
export async function revertAllChanges(sessionId: string): Promise<void> {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const pending = session.changes.filter((change) => change.status === 'pending');
  if (pending.length === 0) {
    toast('info', 'There are no pending changes to revert.', 'Nothing to revert');
    return;
  }
  const proceed = await him.dialog.confirm({
    title: 'Revert all pending changes?',
    message: `Revert ${pending.length} file${pending.length === 1 ? '' : 's'} changed by this agent?`,
    detail:
      'Each file is restored to the content it had before the agent edited it. Added files are moved to the recycle bin. This cannot be undone.',
    confirmLabel: 'Revert all',
    danger: true,
  });
  if (!proceed) return;
  let reverted = 0;
  const failed: string[] = [];
  for (const change of pending) {
    try {
      const exists = await him.fs.exists(change.absPath);
      if (change.kind === 'added') {
        if (exists) await him.fs.trash(change.absPath);
      } else {
        await him.fs.writeFile(change.absPath, change.before);
      }
      useSessionStore.getState().setChangeStatus(sessionId, change.path, 'reverted');
      reverted += 1;
      const editor = useEditorStore.getState();
      const tab = editor.tabs.find(
        (item) => item.path.replaceAll('\\', '/').toLowerCase() === change.absPath.toLowerCase(),
      );
      if (change.kind === 'added') {
        if (tab) editor.closeTab(tab.path);
      } else if (tab) {
        await editor.reloadFromDisk(change.absPath, true);
      }
    } catch (error) {
      failed.push(`${change.path}: ${cleanErrorMessage(error)}`);
    }
  }
  const core = useCoreStore.getState();
  core.bumpFs();
  void core.refreshGit();
  void core.refreshWorkspaceFiles();
  if (failed.length > 0) {
    toast('error', `${reverted} reverted, ${failed.length} failed. ${failed[0]}`, 'Revert incomplete');
  } else {
    toast('success', `${reverted} file${reverted === 1 ? '' : 's'} restored.`, 'Changes reverted');
  }
}

export function saveMessageAsArtifact(sessionId: string, messageId: string): void {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  const message = session?.messages.find((item) => item.id === messageId);
  if (!session || !message || !message.content.trim()) return;
  const heading = /(^|\n)#{1,2}\s+(.+)/.exec(message.content);
  const title = heading?.[2]?.trim() || `Notes · ${new Date().toLocaleTimeString()}`;
  useSessionStore.getState().upsertArtifact(sessionId, {
    id: uid('artifact'),
    title,
    kind: session.permission === 'plan' ? 'plan' : 'notes',
    content: message.content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    comments: [],
  });
  useAgentUiStore.getState().setTab('artifacts');
  useAgentUiStore.getState().setInspectorOpen(true);
  toast('success', `Saved "${title}" to Artifacts.`, 'Artifact saved');
}

export function sendArtifactFeedback(
  sessionId: string,
  artifactId: string,
  commentId?: string,
): void {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  const artifact = session?.artifacts.find((item) => item.id === artifactId);
  if (!session || !artifact) return;
  if (session.status === 'running' || session.status === 'waiting') {
    toast('info', 'The agent is busy. Stop it before sending artifact feedback.');
    return;
  }
  const comments = artifact.comments.filter((comment) =>
    commentId ? comment.id === commentId : !comment.sent,
  );
  if (comments.length === 0) {
    toast('info', 'Add a comment before sending feedback.');
    return;
  }
  const body = comments.map((comment) => `- ${comment.body}`).join('\n');
  const prompt = `Feedback on artifact "${artifact.title}":\n\n${body}\n\nRevise the artifact where needed, then continue the implementation if appropriate.`;
  for (const comment of comments) {
    useSessionStore.getState().markArtifactCommentSent(sessionId, artifactId, comment.id);
  }
  void sendPrompt(sessionId, prompt);
}

export function applyAgentCode(code: string): void {
  if (applyCodeToEditor(code)) {
    toast('success', 'Applied to the active editor selection.', 'Code applied');
  } else {
    toast('info', 'Open a file in IDE mode first, then apply the snippet.');
  }
}

export async function revealInEditor(path: string, line?: number, column?: number): Promise<void> {
  switchMode('ide');
  useEditorStore.getState().setSidebarView('explorer');
  await useEditorStore.getState().openFile(path, line ? { line, column } : undefined);
}

export async function askAgentToFix(input: {
  title: string;
  details: string;
  sessionId?: string;
  createIfMissing?: boolean;
}): Promise<void> {
  const sessions = useSessionStore.getState();
  let session =
    (input.sessionId && sessions.sessions.find((item) => item.id === input.sessionId)) ||
    sessions.sessions.find((item) => item.id === sessions.activeId) ||
    null;
  if (!session && input.createIfMissing !== false) {
    session = await createAgent();
  }
  if (!session) {
    toast('error', 'Create an agent first.', 'No agent selected');
    return;
  }
  if (session.status === 'running' || session.status === 'waiting') {
    toast('info', 'That agent is busy. Wait for it to finish or spawn another agent.', 'Agent busy');
    return;
  }
  useSessionStore.getState().setActive(session.id);
  switchMode('agent');
  const prompt = `${input.title}\n\n${input.details}\n\nInvestigate the failure, fix the root cause, and validate the fix.`;
  void sendPrompt(session.id, prompt);
}

/**
 * Sends a free-form prompt to a HIM+ agent session, creating one when needed.
 * Used by the notebook/data UI to ask the agent about data.
 */
export async function askAgent(prompt: string): Promise<void> {
  const store = useSessionStore.getState();
  const active = store.sessions.find((session) => session.id === store.activeId) || null;
  let session =
    (active && active.backend !== 'acp' ? active : null) ||
    store.sessions.find((item) => item.backend !== 'acp') ||
    null;
  if (!session) {
    session = await createAgent();
  }
  if (!session) {
    toast('error', 'Could not create an agent session for this request.', 'No agent');
    return;
  }
  useSessionStore.getState().setActive(session.id);
  switchMode('agent');
  void sendPrompt(session.id, prompt);
}

export function selectSessionModel(ref: { providerId: string; modelId: string } | null): void {
  const sessionId = useSessionStore.getState().activeId;
  if (sessionId) useSessionStore.getState().setModel(sessionId, ref);
}

const acpModelLoads = new Map<string, Promise<void>>();
const acpAutoLoadAttempts = new Set<string>();

/**
 * Connects to the ACP agent for a session and stores the model catalog the
 * agent advertises (OpenCode and similar agents ship their own 100+ model list).
 */
export function loadAcpModels(sessionId: string): Promise<void> {
  const existing = acpModelLoads.get(sessionId);
  if (existing) return existing;
  const task = (async () => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session || session.backend !== 'acp') return;
    if (session.status === 'running' || session.status === 'waiting') return;
    const profile = useConfigStore
      .getState()
      .config?.acpAgents.find((item) => item.id === session.acpProfileId);
    if (!profile) {
      toast('error', 'This session has no ACP profile configured.', 'ACP models');
      return;
    }
    try {
      toast(
        'info',
        `Connecting to ${profile.name}. If this agent needs sign-in, complete it in the browser window that opens.`,
        'ACP models',
      );
      const result = await him.acp.connect({
        sessionId,
        profile,
        cwd: session.workspaceRoot,
        permission: session.permission,
      });      if (!result.ok) {
        toast('error', result.error || 'Could not connect to the ACP agent.', 'ACP models');
        return;
      }
      if (result.capabilities) {
        useSessionStore
          .getState()
          .setAcpVision(sessionId, result.capabilities.image === true);
      }
      if (result.models) {
        useSessionStore.getState().setAcpModels(sessionId, result.models);
      } else {
        toast(
          'info',
          `${profile.name} did not expose a model list; it manages its own default model.`,
          'ACP models',
        );
      }
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'ACP models');
    }
  })().finally(() => {
    acpModelLoads.delete(sessionId);
  });
  acpModelLoads.set(sessionId, task);
  return task;
}

/** One automatic model discovery attempt per ACP session (used when it opens). */
export function ensureAcpModels(sessionId: string): void {
  if (acpAutoLoadAttempts.has(sessionId)) return;
  acpAutoLoadAttempts.add(sessionId);
  void loadAcpModels(sessionId);
}

export async function setAcpModel(sessionId: string, modelId: string): Promise<void> {
  try {
    const result = await him.acp.setModel({ sessionId, modelId });
    if (!result.ok) {
      toast('error', result.error || 'The ACP agent rejected that model.', 'ACP model');
      return;
    }
    if (result.models) {
      useSessionStore.getState().setAcpModels(sessionId, result.models);
    }
    const name =
      result.models?.availableModels.find((model) => model.modelId === modelId)?.name ||
      modelId;
    toast('success', `ACP model set to ${name}.`, 'Model changed');
  } catch (error) {
    toast('error', cleanErrorMessage(error), 'ACP model');
  }
}

export function setPrimaryModel(ref: { providerId: string; modelId: string } | null): void {
  useConfigStore.getState().setDefault('primary', ref);
  const sessionId = useSessionStore.getState().activeId;
  if (sessionId) useSessionStore.getState().setModel(sessionId, ref);
}

export function removeAgentPathLabel(tabPath: string, workspace: string | null): string {
  return workspace ? relativeTo(workspace, tabPath) : tabPath;
}
