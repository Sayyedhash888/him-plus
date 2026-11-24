import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runHimAgent, type AgentToolContext, type HimChatMessage } from './agent';
import {
  createSession,
  deriveTitle,
  describeSubagents,
  findSession,
  normalizeSessions,
  subagentReport,
  subagentTaskPrompt,
  type ChatSession,
  type SessionMessage,
  type SubagentRunInfo,
} from './sessions';
import {
  defaultHimConfigPath,
  resetHimRuntimeCache,
  resolveHimRuntime,
  resolveHimModel,
} from './himConfig';
import { readFimState, writeFimState } from './himConfigEdit';
import { registerHimFim } from './fim';

const CHAT_KEY = 'him.chat.v1';
const SESSIONS_KEY = 'him.sessions.v1';
const ACTIVE_SESSION_KEY = 'him.sessions.active.v1';
const SELECTED_MODEL_KEY = 'him.chat.model.v1';
const CHAT_CONTAINER = 'workbench.view.extension.him-chat';

function configPath(): string {
  return vscode.workspace.getConfiguration('him').get<string>('configPath', '');
}

function apiKeyOverride(): string {
  return vscode.workspace.getConfiguration('him').get<string>('apiKey', '');
}

function desktopCandidates(): string[] {
  const configured = vscode.workspace.getConfiguration('him').get<string>('desktopPath');
  return [
    configured || '',
    'D:\\HIM+\\release\\HIM+-win32-x64\\HIM+.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'HIM+', 'HIM+.exe'),
    path.join(process.env.ProgramFiles || '', 'HIM+', 'HIM+.exe'),
  ].filter(Boolean);
}

function resolveDesktop(): string | null {
  for (const candidate of desktopCandidates()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next location
    }
  }
  return null;
}

async function openConfig(): Promise<void> {
  const file = defaultHimConfigPath(configPath());
  if (!fs.existsSync(file)) {
    await vscode.window.showInformationMessage(
      'HIM+ has not written its configuration yet. Launch the HIM+ desktop app once.',
    );
    return;
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
}

async function openDesktop(): Promise<void> {
  const executable = resolveDesktop();
  if (!executable) {
    const action = await vscode.window.showErrorMessage(
      'HIM+ desktop app was not found. Set "him.desktopPath" to HIM+.exe.',
      'Open Settings',
    );
    if (action === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'him.desktopPath');
    }
    return;
  }
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  try {
    spawn(executable, workspace ? ['--workspace', workspace] : [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not launch HIM+: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isFimEnabled(): boolean {
  return vscode.workspace.getConfiguration('him').get<boolean>('autocomplete.enabled', true);
}

/**
 * `him.toggleFim` — flips `fim.enabled` in the HIM+ desktop app's config.json.
 * The desktop app owns that flag, so this is the only place the extension writes
 * it; the setting in `him.autocomplete.enabled` is a separate, extension-side gate.
 */
async function toggleFimInApp(): Promise<void> {
  const file = defaultHimConfigPath(configPath());
  const state = readFimState(file);
  if (!state.found) {
    await vscode.window.showWarningMessage(
      `HIM+ config.json was not found at ${file}. Launch the HIM+ desktop app once.`,
    );
    return;
  }
  const next = !state.enabled;
  const result = writeFimState(file, { enabled: next });
  if (!result.ok) {
    await vscode.window.showErrorMessage(`Could not update HIM+ FIM setting: ${result.reason}`);
    return;
  }
  resetHimRuntimeCache();

  const mode = state.mode === 'fim' ? 'FIM' : 'chat';
  const action = await vscode.window.showInformationMessage(
    `HIM+ autocomplete ${next ? 'enabled' : 'disabled'} in config.json (mode: ${mode}). ` +
      'Restart the HIM+ desktop app so its in-memory config does not overwrite this change.',
    'Enable FIM mode',
  );
  if (action === 'Enable FIM mode' && state.mode !== 'fim') {
    const swapped = writeFimState(file, { mode: 'fim' });
    resetHimRuntimeCache();
    if (!swapped.ok) {
      await vscode.window.showErrorMessage(`Could not switch FIM mode: ${swapped.reason}`);
      return;
    }
    await vscode.window.showInformationMessage(
      'HIM+ autocomplete now calls the native /completions endpoint (mode: fim).',
    );
  }
}

function updateFimStatus(item: vscode.StatusBarItem): void {
  const enabled = isFimEnabled();
  const app = readFimState(defaultHimConfigPath(configPath()));
  const appOff = app.found && !app.enabled;
  item.text = enabled ? '$(sparkle) HIM+ FIM' : '$(circle-slash) HIM+ FIM';
  if (appOff) {
    item.text = '$(warning) HIM+ FIM off';
    item.tooltip =
      'HIM+ autocomplete is disabled in the HIM+ desktop app (fim.enabled = false in config.json). Click to enable it.';
    item.command = 'him.toggleFim';
    return;
  }
  item.tooltip = enabled
    ? 'HIM+ inline completions are on. Click to use vendor completions instead.'
    : 'HIM+ inline completions are off. Click to enable.';
  item.command = 'him.toggleAutocomplete';
}

class MissionControlProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'him.chat';
  private view: vscode.WebviewView | null = null;
  private sessions: ChatSession[] = [];
  private activeSessionId = '';
  private subagents: Array<SubagentRunInfo & { sessionId: string }> = [];
  private subagentControllers = new Map<string, AbortController>();
  private runningSessionId: string | null = null;
  private running = false;
  private controller: AbortController | null = null;
  private selectedModel: import('./himConfig').HimModelRef | null = null;
  private notice: { tone: 'error' | 'muted'; message: string } | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    const storedModel = context.workspaceState.get<import('./himConfig').HimModelRef | null>(
      SELECTED_MODEL_KEY,
      null,
    );
    this.selectedModel = storedModel?.providerId && storedModel?.modelId ? storedModel : null;
    const stored = normalizeSessions(
      context.workspaceState.get(SESSIONS_KEY),
      context.workspaceState.get<HimChatMessage[]>(CHAT_KEY, []),
    );
    this.sessions = stored.sessions;
    this.activeSessionId = stored.activeId || this.sessions[0]?.id || '';
  }

  private get activeSession(): ChatSession {
    const found = findSession(this.sessions, this.activeSessionId);
    if (found) return found;
    const session = createSession();
    this.sessions.push(session);
    this.activeSessionId = session.id;
    return session;
  }

  private async persistSessions(): Promise<void> {
    const active = this.activeSession;
    await this.context.workspaceState.update(SESSIONS_KEY, this.sessions);
    await this.context.workspaceState.update(ACTIVE_SESSION_KEY, this.activeSessionId);
    // Keep the legacy single-transcript key in sync for older builds.
    await this.context.workspaceState.update(CHAT_KEY, active.history.slice(-30));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((message: { type?: string; text?: string }) => {
      void this.handleMessage(message).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[ui] ${detail}`);
      });
    });
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  handleConfigChanged(): void {
    void this.postState();
  }

  newChat(): void {
    this.controller?.abort();
    this.controller = null;
    this.running = false;
    this.runningSessionId = null;
    this.abortSubagents(this.activeSessionId);
    const session = createSession();
    this.sessions.push(session);
    this.activeSessionId = session.id;
    this.notice = null;
    void this.persistSessions();
    void this.postState();
  }

  selectSession(sessionId: string): void {
    if (!findSession(this.sessions, sessionId)) return;
    if (sessionId === this.activeSessionId) return;
    if (this.running) {
      this.controller?.abort();
      this.controller = null;
      this.running = false;
      this.runningSessionId = null;
    }
    this.activeSessionId = sessionId;
    this.notice = null;
    void this.persistSessions();
    void this.postState();
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessions.length <= 1) return;
    this.abortSubagents(sessionId);
    if (this.runningSessionId === sessionId) {
      this.controller?.abort();
      this.controller = null;
      this.running = false;
      this.runningSessionId = null;
    }
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);
    if (!findSession(this.sessions, this.activeSessionId)) {
      this.activeSessionId = this.sessions[this.sessions.length - 1]?.id || '';
    }
    await this.persistSessions();
    await this.postState();
  }

  /** Copies the current transcript into a fresh review agent and starts it. */
  async handoff(): Promise<void> {
    const source = this.activeSession;
    const copy = createSession(
      source.history.map((message) => ({ ...message })),
      `Review: ${source.title}`,
    );
    this.sessions.push(copy);
    this.activeSessionId = copy.id;
    await this.persistSessions();
    await this.postState();
    await this.send(
      'You are a review agent receiving a handoff from another HIM+ session. Review the conversation above for correctness, regressions and missed requirements. Verify claims by reading the workspace; report concrete issues with file paths. The extension is read-only — propose changes rather than applying them.',
    );
  }

  private async persist(): Promise<void> {
    await this.persistSessions();
  }

  private async handleMessage(message: {
    type?: string;
    text?: string;
    sessionId?: string;
  }): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      return;
    }
    if (message.type === 'send') {
      await this.send(String(message.text || ''));
      return;
    }
    if (message.type === 'stop') {
      this.controller?.abort();
      if (this.runningSessionId) this.abortSubagents(this.runningSessionId);
      return;
    }
    if (message.type === 'newChat' || message.type === 'newSession') {
      this.newChat();
      return;
    }
    if (message.type === 'selectSession') {
      this.selectSession(String(message.sessionId || ''));
      return;
    }
    if (message.type === 'deleteSession') {
      await this.deleteSession(String(message.sessionId || ''));
      return;
    }
    if (message.type === 'handoff') {
      await this.handoff();
      return;
    }
    if (message.type === 'refresh') {
      this.postState();
      return;
    }
    if (message.type === 'openDesktop') {
      await openDesktop();
      return;
    }
    if (message.type === 'openConfig') {
      await openConfig();
      return;
    }
    if (message.type === 'selectModel') {
      const selected = message as {
        type?: string;
        providerId?: string | null;
        modelId?: string | null;
      };
      const next =
        selected.providerId && selected.modelId
          ? { providerId: selected.providerId, modelId: selected.modelId }
          : null;
      const runtime = await resolveHimRuntime(configPath(), apiKeyOverride());
      if (
        next &&
        !runtime?.config.providers
          .find((provider) => provider.id === next.providerId)
          ?.models.some((model) => model.id === next.modelId && model.enabled)
      ) {
        this.notice = { tone: 'error', message: 'That model is not enabled in HIM+.' };
        this.postState();
        return;
      }
      this.selectedModel = next;
      await this.context.workspaceState.update(SELECTED_MODEL_KEY, next);
      this.postState();
      return;
    }
    if (message.type === 'toggleFim') {
      const settings = vscode.workspace.getConfiguration('him');
      await settings.update(
        'autocomplete.enabled',
        !settings.get<boolean>('autocomplete.enabled', true),
        vscode.ConfigurationTarget.Global,
      );
      await this.postState();
      return;
    }
    if (message.type === 'toggleFimInApp') {
      await toggleFimInApp();
      await this.postState();
      return;
    }
    if (message.type === 'reloadConfig') {
      resetHimRuntimeCache();
      await this.postState();
    }
  }

  private async send(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || this.running) return;
    const runtime = await resolveHimRuntime(configPath(), apiKeyOverride());
    const model = runtime ? resolveHimModel(runtime.config, this.selectedModel, 'primary') : null;
    if (runtime?.keyError) {
      this.notice = { tone: 'error', message: runtime.keyError };
      this.postState();
      return;
    }
    if (!runtime || !model) {
      this.notice = {
        tone: 'error',
        message:
          'No HIM+ model is configured. Open the HIM+ configuration and enable a provider model.',
      };
      this.postState();
      return;
    }

    this.notice = null;
    const session = this.activeSession;
    const sessionId = session.id;
    const priorHistory = session.history.slice();
    session.history.push({ role: 'user', content: prompt });
    session.history = session.history.slice(-30);
    if (session.title === 'New chat') session.title = deriveTitle(session.history);
    session.updatedAt = Date.now();
    await this.persistSessions();
    this.running = true;
    this.runningSessionId = sessionId;
    this.controller = new AbortController();
    const context: AgentToolContext = {
      spawnSubagent: (task, label) => this.startSubagent(sessionId, task, label),
      listSubagents: () => this.listSubagents(sessionId),
    };
    this.view?.webview.postMessage({ type: 'reset-progress' });
    this.postState();

    try {
      const answer = await runHimAgent({
        prompt,
        history: priorHistory,
        modelRef: this.selectedModel,
        signal: this.controller.signal,
        context,
        onEvent: (event) => {
          if (event.type === 'tool') {
            this.view?.webview.postMessage({
              type: 'tool',
              name: event.name,
              detail: event.detail,
            });
          }
        },
      });
      session.history.push({ role: 'assistant', content: answer });
      session.history = session.history.slice(-30);
      session.updatedAt = Date.now();
      await this.persistSessions();
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        this.notice = { tone: 'muted', message: 'Stopped.' };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[agent] ${message}`);
        this.notice = { tone: 'error', message };
      }
    } finally {
      this.running = false;
      this.runningSessionId = null;
      this.controller = null;
      this.postState();
    }
  }

  private startSubagent(sessionId: string, task: string, label?: string): string {
    const session = findSession(this.sessions, sessionId);
    if (!session) return 'That session no longer exists.';
    const active = this.subagents.filter(
      (run) => run.sessionId === sessionId && run.status === 'running',
    );
    if (active.length >= 3) {
      return 'Subagent limit reached (3 running). Wait for one to finish or use list_subagents.';
    }
    const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const cleanLabel = (label || task).trim().slice(0, 60) || 'subagent';
    const run: SubagentRunInfo & { sessionId: string } = {
      id,
      label: cleanLabel,
      status: 'running',
      startedAt: Date.now(),
      sessionId,
    };
    this.subagents.push(run);
    const controller = new AbortController();
    this.subagentControllers.set(id, controller);
    void this.postState();
    void runHimAgent({
      prompt: subagentTaskPrompt(task, cleanLabel),
      history: [],
      modelRef: this.selectedModel,
      signal: controller.signal,
      onEvent: () => undefined,
    })
      .then((result) => {
        run.status = 'done';
        run.result = result;
        session.history.push({ role: 'assistant', content: subagentReport(cleanLabel, result) });
        session.history = session.history.slice(-30);
        session.updatedAt = Date.now();
        this.output.appendLine(`[subagent ${id}] done`);
        void this.persistSessions();
      })
      .catch((error) => {
        if ((error as Error)?.name === 'AbortError') {
          run.status = 'error';
          run.error = 'cancelled';
        } else {
          run.status = 'error';
          run.error = error instanceof Error ? error.message : String(error);
          session.history.push({
            role: 'assistant',
            content: `**Background subagent “${cleanLabel}” failed**\n\n${run.error}`,
          });
          session.history = session.history.slice(-30);
          void this.persistSessions();
        }
        this.output.appendLine(`[subagent ${id}] ${run.error}`);
      })
      .finally(() => {
        this.subagentControllers.delete(id);
        void this.postState();
      });
    return `Started subagent ${id} (“${cleanLabel}”) in the background. Its result will be posted into this chat; use list_subagents to check status.`;
  }

  private listSubagents(sessionId: string): string {
    return describeSubagents(this.subagents.filter((run) => run.sessionId === sessionId));
  }

  private abortSubagents(sessionId: string): void {
    for (const run of this.subagents) {
      if (run.sessionId !== sessionId || run.status !== 'running') continue;
      this.subagentControllers.get(run.id)?.abort();
    }
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    const settings = vscode.workspace.getConfiguration('him');
    const runtime = await resolveHimRuntime(configPath(), apiKeyOverride());
    const config = runtime?.config ?? null;
    const model = config ? resolveHimModel(config, this.selectedModel, 'primary') : null;
    const fimState = readFimState(defaultHimConfigPath(configPath()));
    const models = config
      ? config.providers.flatMap((provider) =>
          provider.models
            .filter((entry) => entry.enabled)
            .map((entry) => ({
              providerId: provider.id,
              modelId: entry.id,
              provider: provider.name,
            })),
        )
      : [];
    const enabledModels = config
      ? config.providers.reduce(
          (total, provider) =>
            total + provider.models.filter((entry) => entry.enabled).length,
          0,
        )
      : 0;
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.view.webview.postMessage({
      type: 'state',
      state: {
        messages: this.activeSession.history,
        sessions: this.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          messageCount: session.history.length,
        })),
        activeSessionId: this.activeSessionId,
        subagents: this.subagents
          .filter((run) => run.sessionId === this.activeSessionId)
          .map((run) => ({
            id: run.id,
            label: run.label,
            status: run.status,
            error: run.error,
            startedAt: run.startedAt,
          })),
        running: this.running && this.runningSessionId === this.activeSessionId,
        model: model?.label || '',
        models,
        selectedModel: this.selectedModel,
        enabledModels,
        fimEnabled: settings.get<boolean>('autocomplete.enabled', true),
        fimAppEnabled: fimState.found ? fimState.enabled : null,
        fimMode: fimState.mode,
        fimModel: fimState.model,
        workspace,
        notice: this.notice,
        configPath: defaultHimConfigPath(configPath()),
        configError: runtime?.keyError
          ? runtime.keyError
          : config
            ? model
              ? ''
              : 'No enabled HIM+ model. Enable a provider/model in the HIM+ desktop settings.'
            : 'HIM+ config not found. Launch the HIM+ desktop app once or set him.configPath.',
      },
    });
  }

  private html(): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    color-scheme: light dark;
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); }
  button, textarea { font: inherit; }
  button { cursor: pointer; }
  .head { flex: none; padding: 12px 12px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .brand { display: flex; align-items: center; gap: 8px; }
  .mark { width: 25px; height: 25px; border-radius: 6px; display: grid; place-items: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); flex: none; }
  .brand-title { font-size: 12.5px; font-weight: 700; letter-spacing: .015em; }
  .brand-kicker { margin-top: 1px; font-size: 8px; letter-spacing: .14em; text-transform: uppercase; opacity: .55; }
  .workspace { margin-top: 7px; font-family: var(--vscode-editor-font-family); font-size: 9px; opacity: .58; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; align-items: center; gap: 5px; margin-top: 8px; min-width: 0; }
  .chip { min-width: 0; max-width: 100%; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 2px 7px; font-size: 8.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .8; }
  .chip.model { flex: 1; font-family: var(--vscode-editor-font-family); }
  .model-button { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: transparent; color: var(--vscode-foreground); padding: 3px 6px; text-align: left; }
  .model-button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .model-button:disabled { opacity: .4; cursor: default; }
  .model-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 0; }
  .model-provider { font-size: 7.5px; line-height: 1.25; opacity: .5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .model-name { font-family: var(--vscode-editor-font-family); font-size: 9.5px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chevron { flex: none; opacity: .5; }
  .menu-backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
  .model-menu { position: fixed; z-index: 50; left: 8px; right: 8px; top: 80px; max-height: calc(100vh - 160px); display: flex; flex-direction: column; background: var(--vscode-dropdown-background, var(--vscode-sideBar-background)); border: 1px solid var(--vscode-panel-border); border-radius: 7px; box-shadow: 0 8px 24px rgba(0,0,0,.38); overflow: hidden; }
  .model-menu-head { padding: 8px 9px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  .menu-label { font-size: 8px; letter-spacing: .14em; text-transform: uppercase; opacity: .55; margin-bottom: 5px; }
  .model-search { width: 100%; border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 5px 7px; font-size: 10px; outline: none; }
  .model-search:focus { border-color: var(--vscode-focusBorder); }
  .model-list { overflow-y: auto; padding: 4px; }
  .model-item { width: 100%; display: flex; align-items: flex-start; gap: 6px; padding: 6px 7px; border: 0; border-radius: 4px; background: transparent; color: var(--vscode-foreground); text-align: left; }
  .model-item:hover { background: var(--vscode-list-hoverBackground); }
  .model-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .model-item .check { flex: none; width: 10px; font-size: 10px; opacity: .8; }
  .model-item-text { min-width: 0; flex: 1; }
  .model-item-name { display: block; font-family: var(--vscode-editor-font-family); font-size: 10px; line-height: 1.35; word-break: break-all; }
  .model-item-provider { display: block; margin-top: 1px; font-size: 8.5px; opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .model-empty { padding: 10px 8px; font-size: 9px; opacity: .55; }
  .model-foot { padding: 6px 9px 7px; border-top: 1px solid var(--vscode-panel-border); font-size: 8.5px; opacity: .55; line-height: 1.4; }
  .fim { flex: none; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 2px 7px; font-size: 8.5px; color: var(--vscode-foreground); background: transparent; }
  .fim.on { border-color: var(--vscode-button-background); color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .fim.warn { border-color: var(--vscode-editorWarning-foreground, #cca700); color: var(--vscode-editorWarning-foreground, #cca700); }
  .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .messages::-webkit-scrollbar { width: 8px; }
  .messages::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 8px; }
  .empty { margin: auto; text-align: center; max-width: 260px; padding: 16px 4px; }
  .empty .art { width: 38px; height: 38px; margin: 0 auto 9px; border-radius: 9px; display: grid; place-items: center; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .empty h2 { margin: 0 0 4px; font-size: 12px; font-weight: 650; }
  .empty p { margin: 0; font-size: 10px; line-height: 1.5; opacity: .65; }
  .suggestions { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; text-align: left; }
  .suggestion { width: 100%; border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 7px 8px; background: transparent; color: var(--vscode-foreground); text-align: left; font-size: 10px; }
  .suggestion:hover { background: var(--vscode-toolbar-hoverBackground); }
  .row { display: flex; flex-direction: column; gap: 3px; }
  .row.user { align-items: flex-end; }
  .who { font-size: 8.5px; opacity: .5; }
  .bubble { max-width: 94%; border-radius: 7px; padding: 7px 9px; font-size: 11px; line-height: 1.5; word-break: break-word; }
  .user .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-top-right-radius: 2px; }
  .assistant .bubble { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); border-top-left-radius: 2px; }
  .bubble p { margin: 0 0 6px; }
  .bubble p:last-child { margin-bottom: 0; }
  .bubble pre { margin: 6px 0; padding: 7px; overflow-x: auto; border-radius: 4px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); }
  .bubble code { font-family: var(--vscode-editor-font-family); font-size: 10px; }
  .bubble :not(pre) > code { background: var(--vscode-textCodeBlock-background); padding: 1px 3px; border-radius: 3px; }
  .notice { flex: none; margin: 0 12px 8px; padding: 7px 8px; border-radius: 5px; font-size: 9.5px; line-height: 1.45; }
  .notice.error { color: var(--vscode-inputValidation-errorForeground); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .notice.muted { color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
  .progress { flex: none; padding: 0 12px 5px; display: flex; flex-direction: column; gap: 3px; }
  .tool-line { font-family: var(--vscode-editor-font-family); font-size: 8.5px; opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .composer { flex: none; padding: 8px 12px 10px; border-top: 1px solid var(--vscode-panel-border); }
  .input-wrap { display: flex; align-items: flex-end; gap: 5px; border: 1px solid var(--vscode-input-border); border-radius: 6px; background: var(--vscode-input-background); padding: 4px 5px 4px 8px; }
  .input-wrap:focus-within { border-color: var(--vscode-focusBorder); }
  textarea { flex: 1; min-height: 30px; max-height: 110px; resize: none; border: 0; outline: none; background: transparent; color: var(--vscode-input-foreground); font-size: 11px; line-height: 1.45; padding: 5px 0; }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  .send { flex: none; width: 26px; height: 26px; border: 0; border-radius: 5px; display: grid; place-items: center; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .send:disabled { opacity: .35; cursor: default; }
  .send.stop { background: var(--vscode-inputValidation-errorBorder); color: #fff; }
  .footer { flex: none; display: flex; align-items: center; gap: 4px; padding: 0 12px 9px; }
  .link { border: 0; background: transparent; color: var(--vscode-textLink-foreground); font-size: 9px; padding: 2px 0; }
  .link:hover { text-decoration: underline; }
  .spacer { flex: 1; }
  .thinking { display: flex; align-items: center; gap: 6px; font-size: 10px; opacity: .65; padding: 2px 0 7px; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--vscode-progressBar-background); animation: pulse 1.1s infinite ease-in-out; }
  .dot:nth-child(2) { animation-delay: .15s; }.dot:nth-child(3) { animation-delay: .3s; }
  @keyframes pulse { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }
  .hidden { display: none !important; }
  .sessionbar { flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .session-select { flex: 1; min-width: 0; height: 21px; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-radius: 4px; font-size: 9.5px; padding: 0 4px; outline: none; }
  .session-btn { flex: none; height: 21px; min-width: 21px; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-radius: 4px; font-size: 9px; padding: 0 5px; }
  .session-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
  .session-btn:disabled { opacity: .35; }
  .session-btn.handoff { color: var(--vscode-textLink-foreground); }
  .subagents { flex: none; display: flex; flex-direction: column; gap: 2px; padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 9px; }
  .subagent { display: flex; align-items: center; gap: 5px; color: var(--vscode-descriptionForeground); }
  .subagent .badge { font-size: 8px; text-transform: uppercase; letter-spacing: .05em; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 0 3px; }
  .subagent.running .badge { color: var(--vscode-progressBar-background); }
  .subagent.done .badge { color: var(--vscode-testing-iconPassed, #3fb950); }
  .subagent.error .badge { color: var(--vscode-errorForeground); }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      <div class="mark">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M3 3h3.4v18H3zM6.4 10.2h4.8v3.4H6.4zM10.4 3h6.6v18h-6.6zM12.7 5.1h2v6.2h-2zM11.2 7.7h5v2.1h-5z"/></svg>
      </div>
      <div>
        <div class="brand-title">HIM+</div>
        <div class="brand-kicker">HIM+ Code · Extension host</div>
      </div>
    </div>
    <div id="workspace" class="workspace"></div>
    <div class="meta">
      <button id="modelButton" class="model-button" title="Choose chat model">
        <span class="model-text"><span id="modelProvider" class="model-provider">No provider</span><span id="modelName" class="model-name">No model</span></span>
        <svg class="chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <button id="fim" class="fim" title="Toggle HIM+ inline completions">FIM</button>
    </div>
  </div>

  <div id="modelBackdrop" class="menu-backdrop hidden"></div>
  <div id="modelMenu" class="model-menu hidden">
    <div class="model-menu-head">
      <div class="menu-label">Chat model</div>
      <input id="modelSearch" class="model-search" placeholder="Filter enabled models…" spellcheck="false" />
    </div>
    <div id="modelList" class="model-list"></div>
    <div class="model-foot">Uses your HIM+ provider and API key. FIM keeps its configured completion model.</div>
  </div>

  <div class="sessionbar">
    <select id="sessionSelect" class="session-select" title="Active agent session"></select>
    <button id="newSession" class="session-btn" title="New agent session">+</button>
    <button id="deleteSession" class="session-btn" title="Delete this session">×</button>
    <button id="handoff" class="session-btn handoff" title="Hand off this conversation to a review agent">Handoff</button>
  </div>
  <div id="subagents" class="subagents hidden"></div>

  <div id="messages" class="messages"></div>
  <div id="progress" class="progress hidden"></div>
  <div id="notice" class="notice hidden"></div>

  <div class="composer">
    <div class="input-wrap">
      <textarea id="prompt" rows="1" placeholder="Ask HIM+ about this workspace…" spellcheck="false"></textarea>
      <button id="send" class="send" title="Send" aria-label="Send">↑</button>
    </div>
    <div class="footer">
      <button id="newChat" class="link">New chat</button>
      <span class="spacer"></span>
      <button id="openDesktop" class="link">Open HIM+ desktop</button>
      <button id="openConfig" class="link">Config</button>
    </div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const tick = String.fromCharCode(96);
  const fenceRe = new RegExp(tick + tick + tick + '[\\\\w-]*\\\\n([\\\\s\\\\S]*?)' + tick + tick + tick, 'g');
  const inlineCodeRe = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
  const boldRe = new RegExp('\\\\*\\\\*([^*]+)\\\\*\\\\*', 'g');
  const els = {
    workspace: document.getElementById('workspace'),
    modelButton: document.getElementById('modelButton'),
    modelProvider: document.getElementById('modelProvider'),
    modelName: document.getElementById('modelName'),
    modelBackdrop: document.getElementById('modelBackdrop'),
    modelMenu: document.getElementById('modelMenu'),
    modelSearch: document.getElementById('modelSearch'),
    modelList: document.getElementById('modelList'),
    fim: document.getElementById('fim'),
    messages: document.getElementById('messages'),
    subagents: document.getElementById('subagents'),
    sessionSelect: document.getElementById('sessionSelect'),
    newSession: document.getElementById('newSession'),
    deleteSession: document.getElementById('deleteSession'),
    handoff: document.getElementById('handoff'),
    progress: document.getElementById('progress'),
    notice: document.getElementById('notice'),
    prompt: document.getElementById('prompt'),
    send: document.getElementById('send'),
    newChat: document.getElementById('newChat'),
    openDesktop: document.getElementById('openDesktop'),
    openConfig: document.getElementById('openConfig'),
  };
  let state = {
    messages: [], sessions: [], activeSessionId: '', subagents: [],
    running: false, model: '', models: [], selectedModel: null, enabledModels: 0,
    fimEnabled: true, fimAppEnabled: null, fimMode: 'chat', fimModel: '',
    workspace: '', configError: '', configPath: ''
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function inline(segment) {
    return escapeHtml(segment)
      .replace(inlineCodeRe, '<code>$1</code>')
      .replace(boldRe, '<strong>$1</strong>')
      .replace(/\\n/g, '<br>');
  }
  function markdown(text) {
    const source = String(text || '');
    let html = '';
    let last = 0;
    let match;
    fenceRe.lastIndex = 0;
    while ((match = fenceRe.exec(source))) {
      html += inline(source.slice(last, match.index));
      html += '<pre><code>' + escapeHtml(match[1]) + '</code></pre>';
      last = fenceRe.lastIndex;
    }
    html += inline(source.slice(last));
    return html;
  }

  function emptyView() {
    return '<div class="empty"><div class="art"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M3 3h3.4v18H3zM6.4 10.2h4.8v3.4H6.4zM10.4 3h6.6v18h-6.6zM12.7 5.1h2v6.2h-2zM11.2 7.7h5v2.1h-5z"/></svg></div><h2>Mission Control</h2><p>Ask HIM+ about this workspace. It can read files, delegate background subagents and explain what is happening.</p><div class="suggestions"><button class="suggestion" data-prompt="Map this workspace and list the important files.">Map this workspace</button><button class="suggestion" data-prompt="Explain the active file and point out likely bugs.">Explain the active file</button><button class="suggestion" data-prompt="Find the most likely cause of the current build or test failure.">Find a failure</button></div></div>';
  }

  function renderSessions() {
    const sessions = state.sessions || [];
    els.sessionSelect.innerHTML = '';
    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = (session.title || 'New chat') + ' · ' + (session.messageCount || 0);
      els.sessionSelect.append(option);
    }
    els.sessionSelect.value = state.activeSessionId || (sessions[0] ? sessions[0].id : '');
    els.deleteSession.disabled = sessions.length <= 1;
    els.newSession.disabled = sessions.length >= 20;
  }

  function renderSubagents() {
    const runs = state.subagents || [];
    els.subagents.innerHTML = '';
    if (!runs.length) {
      els.subagents.classList.add('hidden');
      return;
    }
    els.subagents.classList.remove('hidden');
    for (const run of runs) {
      const row = document.createElement('div');
      row.className = 'subagent ' + run.status;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = run.status === 'running' ? 'bg' : run.status;
      const label = document.createElement('span');
      label.textContent = run.label + (run.status === 'error' && run.error ? ' · ' + run.error : '');
      row.append(badge, label);
      els.subagents.append(row);
    }
  }

  function render() {
    renderSessions();
    renderSubagents();
    els.workspace.textContent = state.workspace || 'No workspace';
    els.workspace.title = state.workspace || '';
    const selected = state.selectedModel
      ? state.models.find(function (m) { return m.providerId === state.selectedModel.providerId && m.modelId === state.selectedModel.modelId; })
      : null;
    const labelParts = (state.model || '').split(' · ');
    els.modelProvider.textContent = selected ? selected.provider : (labelParts.length > 1 ? labelParts[0] : 'No provider');
    els.modelName.textContent = selected ? selected.modelId : (labelParts.length > 1 ? labelParts.slice(1).join(' · ') : (state.configError ? 'Config needed' : 'No model'));
    els.modelButton.disabled = !state.models.length;
    els.modelButton.title = state.configError || state.model || 'Choose chat model';
    els.fim.textContent = 'FIM ' + (state.fimEnabled ? 'on' : 'off');
    els.fim.classList.toggle('on', Boolean(state.fimEnabled));
    const appOff = state.fimAppEnabled === false;
    els.fim.classList.toggle('warn', appOff);
    els.fim.title = appOff
      ? 'Autocomplete is disabled in the HIM+ desktop app (fim.enabled = false in config.json), so HIM+ requests no completions. Click to enable it in config.json.'
      : 'Autocomplete mode: ' +
        (state.fimMode === 'fim' ? 'native FIM (/completions)' : 'chat fallback (/chat/completions)') +
        (state.fimModel ? ' · ' + state.fimModel : '') +
        '. Click to turn HIM+ completions on or off.';
    els.send.textContent = state.running ? '■' : '↑';
    els.send.classList.toggle('stop', state.running);
    els.send.title = state.running ? 'Stop' : 'Send';
    els.send.disabled = !state.running && (!els.prompt.value.trim() || Boolean(state.configError));
    els.prompt.disabled = state.running;

    if (!state.messages.length) {
      els.messages.innerHTML = emptyView();
      els.messages.querySelectorAll('[data-prompt]').forEach(function (button) {
        button.addEventListener('click', function () { send(button.dataset.prompt); });
      });
      return;
    }

    els.messages.innerHTML = '';
    for (const message of state.messages) {
      const row = document.createElement('div');
      row.className = 'row ' + (message.role === 'user' ? 'user' : 'assistant');
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = message.role === 'user' ? 'You' : 'HIM+';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = message.role === 'assistant'
        ? markdown(message.content)
        : escapeHtml(message.content).replace(/\\n/g, '<br>');
      row.append(who, bubble);
      els.messages.append(row);
    }
    if (state.running) {
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      thinking.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span>working</span>';
      els.messages.append(thinking);
    }
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function closeModelMenu() {
    els.modelMenu.classList.add('hidden');
    els.modelBackdrop.classList.add('hidden');
  }
  function chooseModel(providerId, modelId) {
    state.selectedModel = providerId && modelId ? { providerId: providerId, modelId: modelId } : null;
    closeModelMenu();
    render();
    vscode.postMessage({ type: 'selectModel', providerId: providerId || null, modelId: modelId || null });
  }
  function modelItem(providerId, modelId, providerName, modelName, active) {
    const button = document.createElement('button');
    button.className = 'model-item' + (active ? ' active' : '');
    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = active ? '✓' : '';
    const text = document.createElement('span');
    text.className = 'model-item-text';
    const name = document.createElement('span');
    name.className = 'model-item-name';
    name.textContent = modelName;
    const provider = document.createElement('span');
    provider.className = 'model-item-provider';
    provider.textContent = providerName;
    text.append(name, provider);
    button.append(check, text);
    button.addEventListener('click', function () { chooseModel(providerId, modelId); });
    return button;
  }
  function renderModelList() {
    const query = els.modelSearch.value.trim().toLowerCase();
    els.modelList.innerHTML = '';
    const defaultActive = !state.selectedModel;
    els.modelList.append(modelItem('', '', 'Primary model from HIM+ settings', 'HIM+ default', defaultActive));
    const matches = state.models.filter(function (m) {
      return !query || m.modelId.toLowerCase().includes(query) || m.provider.toLowerCase().includes(query);
    });
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'model-empty';
      empty.textContent = state.models.length ? 'No matching enabled models.' : 'No enabled HIM+ models.';
      els.modelList.append(empty);
      return;
    }
    for (const m of matches) {
      const active = state.selectedModel && state.selectedModel.providerId === m.providerId && state.selectedModel.modelId === m.modelId;
      els.modelList.append(modelItem(m.providerId, m.modelId, m.provider, m.modelId, Boolean(active)));
    }
  }
  function openModelMenu() {
    if (!state.models.length) return;
    els.modelSearch.value = '';
    renderModelList();
    const rect = els.modelButton.getBoundingClientRect();
    els.modelMenu.style.top = Math.round(rect.bottom + 6) + 'px';
    els.modelMenu.style.maxHeight = Math.max(180, window.innerHeight - rect.bottom - 18) + 'px';
    els.modelMenu.classList.remove('hidden');
    els.modelBackdrop.classList.remove('hidden');
    requestAnimationFrame(function () { els.modelSearch.focus(); });
  }

  function setNotice(tone, message) {
    els.notice.className = 'notice ' + (tone || 'muted');
    els.notice.textContent = message;
  }
  function clearNotice() {
    els.notice.className = 'notice hidden';
    els.notice.textContent = '';
  }
  function addTool(name, detail) {
    els.progress.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = 'tool-line';
    line.textContent = (name || 'tool') + ' · ' + (detail || '');
    els.progress.append(line);
  }
  function send(text) {
    const prompt = String(text || '').trim();
    if (!prompt || state.running) return;
    clearNotice();
    els.prompt.value = '';
    state.running = true;
    render();
    vscode.postMessage({ type: 'send', text: prompt });
  }

  els.send.addEventListener('click', function () {
    if (state.running) vscode.postMessage({ type: 'stop' });
    else send(els.prompt.value);
  });
  els.prompt.addEventListener('input', render);
  els.prompt.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(els.prompt.value);
    }
  });
  els.newChat.addEventListener('click', function () { clearNotice(); vscode.postMessage({ type: 'newChat' }); });
  els.newSession.addEventListener('click', function () { clearNotice(); vscode.postMessage({ type: 'newSession' }); });
  els.sessionSelect.addEventListener('change', function () {
    clearNotice();
    vscode.postMessage({ type: 'selectSession', sessionId: els.sessionSelect.value });
  });
  els.deleteSession.addEventListener('click', function () {
    if (state.sessions.length <= 1) return;
    vscode.postMessage({ type: 'deleteSession', sessionId: state.activeSessionId });
  });
  els.handoff.addEventListener('click', function () {
    if (state.running) return;
    clearNotice();
    vscode.postMessage({ type: 'handoff' });
  });
  els.openDesktop.addEventListener('click', function () { vscode.postMessage({ type: 'openDesktop' }); });
  els.openConfig.addEventListener('click', function () { vscode.postMessage({ type: 'openConfig' }); });
  els.fim.addEventListener('click', function () {
    // Autocomplete is gated twice: HIM+ config.json owns fim.enabled, this
    // extension owns him.autocomplete.enabled. Fix whichever one is off.
    if (state.fimAppEnabled === false) vscode.postMessage({ type: 'toggleFimInApp' });
    else vscode.postMessage({ type: 'toggleFim' });
  });
  els.modelButton.addEventListener('click', function () {
    if (els.modelMenu.classList.contains('hidden')) openModelMenu();
    else closeModelMenu();
  });
  els.modelBackdrop.addEventListener('click', closeModelMenu);
  els.modelSearch.addEventListener('input', renderModelList);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeModelMenu();
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) return;
    if (message.type === 'state') {
      state = message.state;
      els.progress.innerHTML = '';
      els.progress.classList.add('hidden');
      if (state.notice && state.notice.message) setNotice(state.notice.tone, state.notice.message);
      else if (state.configError) setNotice('error', state.configError);
      else if (state.running) setNotice('muted', 'HIM+ is inspecting the workspace…');
      else clearNotice();
      render();
      if (!els.modelMenu.classList.contains('hidden')) renderModelList();
    } else if (message.type === 'tool') {
      addTool(message.name, message.detail);
    } else if (message.type === 'reset-progress') {
      els.progress.innerHTML = '';
      els.progress.classList.add('hidden');
    } else if (message.type === 'notice') {
      setNotice(message.tone, message.message);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('HIM+');
  context.subscriptions.push(output);
  const provider = new MissionControlProvider(context.extensionUri, context, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MissionControlProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(registerHimFim(output));

  /**
   * Show the HIM+ chat view. `workbench.view.extension.<container>` activates the
   * view container, which reveals the secondary side bar when it is hidden; it is
   * a no-op while the container is already the active one, so it never fights a
   * user who hid the part.
   */
  async function revealChat(force = false): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('him')
      .get<boolean>('chat.openOnStartup', true);
    if (!force && !enabled) return;
    try {
      await vscode.commands.executeCommand(CHAT_CONTAINER);
    } catch (error) {
      output.appendLine(
        `[chat] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('him.openChat', () => revealChat(true)),
    vscode.commands.registerCommand('him.focusChat', () => revealChat(true)),
    vscode.commands.registerCommand('him.openDesktop', () => openDesktop()),
    vscode.commands.registerCommand('him.openConfig', () => openConfig()),
    vscode.commands.registerCommand('him.newChat', async () => {
      provider.newChat();
      await revealChat(true);
    }),
    vscode.commands.registerCommand('him.toggleAutocomplete', async () => {
      const settings = vscode.workspace.getConfiguration('him');
      await settings.update(
        'autocomplete.enabled',
        !settings.get<boolean>('autocomplete.enabled', true),
        vscode.ConfigurationTarget.Global,
      );
    }),
    vscode.commands.registerCommand('him.toggleFim', () => toggleFimInApp()),
    vscode.commands.registerCommand('him.reloadConfig', () => {
      resetHimRuntimeCache();
      provider.handleConfigChanged();
      void vscode.window.showInformationMessage('HIM+ configuration reloaded.');
    }),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  status.text = '$(hubot) HIM+';
  status.tooltip = 'Open HIM+ chat (secondary side bar)';
  status.command = 'him.openChat';
  status.show();
  context.subscriptions.push(status);

  const fimStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 39);
  fimStatus.command = 'him.toggleAutocomplete';
  updateFimStatus(fimStatus);
  fimStatus.show();
  context.subscriptions.push(fimStatus);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.handleConfigChanged()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('him.autocomplete') ||
        event.affectsConfiguration('him.configPath') ||
        event.affectsConfiguration('him.apiKey')
      ) {
        resetHimRuntimeCache();
        updateFimStatus(fimStatus);
        provider.handleConfigChanged();
      }
    }),
  );

  // Let the workbench finish restoring the window layout before the panel is asked
  // for. On the very first run this opens the secondary side bar; afterwards the
  // workbench restores whether the part was visible and this settles to a no-op.
  setTimeout(() => void revealChat(), 900);
}

export function deactivate(): void {
  // Subscriptions are disposed by VS Code.
}