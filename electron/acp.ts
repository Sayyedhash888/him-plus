import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { acpRegistry, checkAcpHealth } from './acpRegistry';
import { getMcpServerConfigs } from './mcp';
import { toAcpMcpServers } from '../shared/acp';
import { fileURLToPath } from 'node:url';
import type {
  AcpConnectRequest,
  AcpConnectResult,
  AcpFileChange,
  AcpPermissionMode,
  AcpPermissionOption,
  AcpPermissionRequest,
  AcpPromptImage,
  AcpPromptRequest,
  AcpPromptResult,
  AcpSetModelRequest,
  AcpStreamEvent,
} from '../shared/acp';
import type { AcpAgentProfile } from '../shared/types';
import { AcpClient } from './acpClient';
import { readAttachmentImage } from './attachments';

const MAX_READ_BYTES = 4 * 1024 * 1024;

interface AcpEntry {
  sessionId: string;
  profile: AcpAgentProfile;
  cwd: string;
  permission: AcpPermissionMode;
  sender: WebContents;
  client: AcpClient;
  acpSessionId: string | null;
  busy: boolean;
}

const entries = new Map<string, AcpEntry>();

function sendEvent(sender: WebContents, event: AcpStreamEvent): void {
  if (!sender.isDestroyed()) sender.send('acp:event', event);
}

function profileSignature(profile: AcpAgentProfile): string {
  return `${profile.id}\u0000${profile.command}\u0000${profile.args.join('\u0000')}\u0000${JSON.stringify(profile.env || {})}`;
}

function resolveInside(root: string, requested: string): string {
  let value = requested.trim();
  if (!value) throw new Error('ACP requested an empty file path.');
  if (value.startsWith('file://')) value = fileURLToPath(value);
  const absolute = path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`ACP file access is limited to the workspace: ${requested}`);
  }
  return absolute;
}

async function readTextFile(
  cwd: string,
  request: { path: string; line?: number | null; limit?: number | null },
): Promise<string> {
  const absolute = resolveInside(cwd, request.path);
  const stat = await fs.stat(absolute);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`File is too large for ACP read access (${stat.size} bytes).`);
  }
  const content = await fs.readFile(absolute, 'utf8');
  if (!request.line && !request.limit) return content;
  const lines = content.split('\n');
  const start = Math.max(0, (request.line || 1) - 1);
  const end = request.limit ? start + Math.max(0, request.limit) : undefined;
  return lines.slice(start, end).join('\n');
}

async function writeTextFile(
  entry: AcpEntry,
  request: { path: string; content: string },
): Promise<void> {
  const absolute = resolveInside(entry.cwd, request.path);
  let before = '';
  try {
    before = await fs.readFile(absolute, 'utf8');
  } catch {
    before = '';
  }
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, request.content, 'utf8');
  const change: AcpFileChange = {
    path: absolute,
    before,
    after: request.content,
  };
  sendEvent(entry.sender, {
    sessionId: entry.sessionId,
    type: 'file',
    change,
  });
}

function optionForKind(
  options: AcpPermissionOption[],
  kinds: string[],
): AcpPermissionOption | null {
  for (const kind of kinds) {
    const found = options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return null;
}

function permissionDetail(toolCall: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof toolCall.kind === 'string') parts.push(`Kind: ${toolCall.kind}`);
  const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
  const paths = locations
    .map((item) =>
      item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string'
        ? (item as { path: string }).path
        : '',
    )
    .filter(Boolean);
  if (paths.length > 0) parts.push(`Files: ${paths.join(', ')}`);
  if (toolCall.rawInput !== undefined) {
    try {
      parts.push(`Input:\n${JSON.stringify(toolCall.rawInput, null, 2).slice(0, 1600)}`);
    } catch {
      // ignore non-serializable input
    }
  }
  return parts.join('\n\n').slice(0, 2400);
}

async function decidePermission(
  entry: AcpEntry,
  request: AcpPermissionRequest,
): Promise<{ optionId: string } | 'cancelled'> {
  const allow =
    optionForKind(request.options, ['allow_once', 'allow_always']) ||
    request.options.find((option) => option.kind?.startsWith('allow')) ||
    null;
  const reject =
    optionForKind(request.options, ['reject_once', 'reject_always']) ||
    request.options.find((option) => option.kind?.startsWith('reject')) ||
    null;

  if (entry.permission === 'plan') {
    return reject ? { optionId: reject.optionId } : 'cancelled';
  }
  if (entry.permission === 'auto') {
    return allow ? { optionId: allow.optionId } : 'cancelled';
  }
  if (!allow) return reject ? { optionId: reject.optionId } : 'cancelled';

  const window = BrowserWindow.fromWebContents(entry.sender);
  if (!window || window.isDestroyed()) {
    return reject ? { optionId: reject.optionId } : 'cancelled';
  }
  const title =
    typeof request.toolCall.title === 'string' && request.toolCall.title.trim()
      ? request.toolCall.title.trim()
      : 'An ACP agent wants to run a tool';
  const result = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'ACP permission',
    message: title,
    detail:
      permissionDetail(request.toolCall) ||
      'Review this operation before allowing the external agent to continue.',
    buttons: [allow.name || 'Allow once', reject?.name || 'Reject'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) return { optionId: allow.optionId };
  return reject ? { optionId: reject.optionId } : 'cancelled';
}

function createEntry(
  sender: WebContents,
  request: AcpPromptRequest,
): AcpEntry {
  const profile = request.profile;
  let entry: AcpEntry | null = null;
  const client: AcpClient = new AcpClient({
    onUpdate: (update) => {
      if (!entry) return;
      sendEvent(sender, {
        sessionId: entry.sessionId,
        type: 'update',
        update,
      });
    },
    onLog: (message, stream) => {
      if (!entry) return;
      sendEvent(sender, {
        sessionId: entry.sessionId,
        type: 'log',
        message,
        stream,
      });
    },
    requestPermission: (permissionRequest) => {
      if (!entry) return Promise.resolve('cancelled' as const);
      return decidePermission(entry, permissionRequest);
    },
    readTextFile: async (fileRequest) => {
      if (!entry) throw new Error('ACP session is no longer active.');
      return readTextFile(entry.cwd, fileRequest);
    },
    writeTextFile: async (fileRequest) => {
      if (!entry) throw new Error('ACP session is no longer active.');
      await writeTextFile(entry, fileRequest);
    },
  });
  entry = {
    sessionId: request.sessionId,
    profile,
    cwd: path.resolve(request.cwd),
    permission: request.permission,
    sender,
    client,
    acpSessionId: null,
    busy: false,
  };
  const created = entry;
  entries.set(created.sessionId, created);
  sender.once('destroyed', () => {
    const current = entries.get(created.sessionId);
    if (!current || current.client !== client) return;
    client.dispose();
    entries.delete(created.sessionId);
  });
  return created;
}

function disposeEntry(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  entry.client.dispose();
  entries.delete(sessionId);
}

export function disposeAcpClients(): void {
  for (const sessionId of [...entries.keys()]) disposeEntry(sessionId);
}

async function runPrompt(
  request: AcpPromptRequest,
  sender: WebContents,
): Promise<AcpPromptResult> {
  if (!request || typeof request.sessionId !== 'string' || typeof request.prompt !== 'string') {
    return { ok: false, error: 'Invalid ACP prompt request.' };
  }
  const prompt = request.prompt.trim();
  const incomingMedia = Array.isArray(request.media) ? request.media : [];
  if (!prompt && incomingMedia.length === 0) {
    return { ok: false, error: 'ACP prompt is empty.' };
  }
  const profile = request.profile;
  if (!profile || !profile.command.trim()) {
    return { ok: false, error: 'The selected ACP profile has no launch command.' };
  }
  const cwd = path.resolve(request.cwd || '');
  if (!request.cwd) return { ok: false, error: 'ACP sessions require a workspace.' };

  let entry = entries.get(request.sessionId);
  if (
    entry &&
    (entry.profile.id !== profile.id ||
      profileSignature(entry.profile) !== profileSignature(profile) ||
      entry.cwd.toLowerCase() !== cwd.toLowerCase())
  ) {
    entry.client.dispose();
    entries.delete(request.sessionId);
    entry = undefined;
  }
  if (entry?.busy) {
    return { ok: false, error: 'This ACP agent is already running a prompt.' };
  }
  if (!entry) {
    entry = createEntry(sender, request);
  }
  entry.permission = request.permission || 'review';
  if (!entry.acpSessionId) {
    const launchIssue = launchPreflight(profile);
    if (launchIssue) {
      entry.client.dispose();
      entries.delete(request.sessionId);
      return { ok: false, error: launchIssue };
    }
    try {
      entry.acpSessionId = await startAgentSession(entry.client, profile, cwd);
    } catch (error) {
      entry.client.dispose();
      entries.delete(request.sessionId);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  entry.busy = true;
  try {
    // Convert pasted images to ACP image content blocks when the agent can accept them.
    let images: AcpPromptImage[] = [];
    let unreadable = 0;
    for (const media of incomingMedia) {
      if (!media || media.kind !== 'image') continue;
      try {
        if (media.path) {
          images.push(await readAttachmentImage(media.path));
        } else if (typeof media.dataUrl === 'string') {
          const match = /^data:([^;]+);base64,(.*)$/s.exec(media.dataUrl);
          if (match) images.push({ mime: match[1], data: match[2] });
          else unreadable += 1;
        } else {
          unreadable += 1;
        }
      } catch {
        unreadable += 1;
      }
    }
    let warning: string | undefined;
    let promptText = prompt;
    if (images.length > 0 && !entry.client.supportsImages) {
      warning = `${entry.profile.name} does not accept image input over ACP, so ${images.length} attached image${images.length === 1 ? '' : 's'} could not be sent. Switch to a HIM+ agent session (or an image-capable ACP agent) to share screenshots.`;
      promptText = `${prompt}${prompt ? '\n\n' : ''}[The user attached ${images.length} image(s), but this agent reports no image input support.]`;
      images = [];
    } else if (images.length === 0 && unreadable > 0) {
      warning = `${unreadable} attached image${unreadable === 1 ? '' : 's'} could not be read and were not sent.`;
    }
    const result = await entry.client.prompt(entry.acpSessionId, promptText, images);
    sendEvent(entry.sender, {
      sessionId: entry.sessionId,
      type: 'done',
      stopReason: result.stopReason,
    });
    return { ok: true, stopReason: result.stopReason, warning, usage: result.usage };
  } catch (error) {
    if (!entry.client.connected) {
      entry.client.dispose();
      entries.delete(request.sessionId);
    }
    return {
      ok: false,
      error: acpFailureHint(
        `${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  } finally {
    entry.busy = false;
  }
}

/** Commands that are resolved by the shell itself, not by where.exe. */
const SHELL_RESOLVED = new Set([
  'npx',
  'npm',
  'pnpm',
  'yarn',
  'bunx',
  'node',
  'uvx',
  'pipx',
  'python',
  'python3',
  'cmd',
  'powershell',
  'pwsh',
]);

/**
 * Catches "command not installed" before spawning. With a Windows shell the
 * spawn itself technically succeeds and the agent exits 1 with a cryptic
 * "not recognized" line, so check PATH up front.
 */
function launchPreflight(profile: AcpAgentProfile): string | null {
  const command = profile.command.trim();
  if (!command) return 'The selected ACP profile has no launch command.';
  if (SHELL_RESOLVED.has(command.toLowerCase())) return null;
  if (/[\\/]/.test(command)) {
    return fsSync.existsSync(command)
      ? null
      : `The ACP command path does not exist: ${command}. Fix it in Settings → Integrations → ACP.`;
  }
  try {
    const probe =
      process.platform === 'win32'
        ? spawnSync('where.exe', [command], { windowsHide: true, encoding: 'utf8' })
        : spawnSync('which', [command], { encoding: 'utf8' });
    if (probe.status === 0 && String(probe.stdout || '').trim()) return null;
  } catch {
    // fall through to the actionable error
  }
  return `The ACP command "${command}" was not found on PATH. Install the agent CLI, or edit the profile in Settings → Integrations → ACP to use an npx-based command (for Kilo, remove this profile and add the "Kilo" preset again).`;
}

/**
 * Starts the agent and opens its session. If the agent requires its own
 * authentication (Cline, Copilot CLI, …) before a session can start, run the
 * advertised authenticate flow once and retry.
 */
async function startAgentSession(
  client: AcpClient,
  profile: AcpAgentProfile,
  cwd: string,
): Promise<string> {
  await client.start({
    command: profile.command,
    args: profile.args,
    cwd,
    env: profile.env,
    shell: process.platform === 'win32',
  });
  // Share HIM+'s configured MCP servers with the external agent. The ACP agent
  // launches its own instances (ACP has no shared-endpoint handshake yet), but
  // both sides use one config/health source and the same tool set.
  let mcpServers: Array<Record<string, unknown>> = [];
  try {
    const configs = await getMcpServerConfigs(cwd);
    mcpServers = toAcpMcpServers(configs).map((config) => ({ ...config }));
  } catch {
    mcpServers = [];
  }
  try {
    return await client.newSession(cwd, mcpServers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const methods = client.getAuthMethods();
    const authRequired =
      /authentication required|not authenticated|call authenticate|unauthorized|login required/i.test(
        message,
      );
    if (!authRequired || methods.length === 0) throw error;
    const interactive = methods.filter(
      (method) =>
        !/terminal|run\s+`|command line|in your shell/i.test(
          `${method.name} ${method.description || ''}`,
        ),
    );
    if (interactive.length === 0) {
      throw new Error(
        `${message} — this agent needs to be signed in outside HIM+ (${methods
          .map((method) => `${method.name}: ${method.description || method.id}`)
          .join('; ')}). Run the agent's login command, then click Load models again.`,
      );
    }
    const method = interactive[0];
    try {
      await client.authenticate(method.id);
      return await client.newSession(cwd);
    } catch (authError) {
      const detail = authError instanceof Error ? authError.message : String(authError);
      throw new Error(
        `${message} — HIM+ attempted "${method.name}" but it did not finish: ${detail}. Complete the agent's sign-in (browser window) and click Load models again.`,
      );
    }
  }
}

function acpFailureHint(message: string): string {
  if (/no models available/i.test(message)) {
    return `${message} — the ACP agent could not load any of its provider models. This is the agent's own provider/auth setup, not HIM+ model settings. For OpenCode run "opencode auth login" (or fix its opencode.json providers), then retry.`;
  }
  if (
    /not recognized as an internal|is not recognized|command not found|spawn .* ENOENT|not found on PATH/i.test(
      message,
    )
  ) {
    return `${message} — the ACP command is not installed or not on PATH. Install the agent CLI, or edit the profile in Settings → Integrations → ACP to use an npx-based command.`;
  }
  if (/unknown option|unknown argument|unrecognized option|invalid option|unexpected argument/i.test(message)) {
    return `${message} — the agent's CLI rejected these ACP flags, so this profile/preset is out of date. Remove the profile in Settings → Integrations → ACP and add it again from the current preset list (and check the agent's own docs for its ACP command).`;
  }
  if (/api key|unauthorized|authentication|auth required|401|403|credential/i.test(message)) {
    return `${message} — this error comes from the external ACP agent's own provider credentials, not from HIM+ model settings. Fix the agent's auth/config, then retry.`;
  }
  return message;
}

/**
 * Starts the ACP agent (if needed) and creates its session so the renderer can
 * read the agent's own model catalog before the first prompt.
 */
async function connectSession(
  request: AcpConnectRequest,
  sender: WebContents,
): Promise<AcpConnectResult> {
  if (!request || typeof request.sessionId !== 'string' || !request.sessionId) {
    return { ok: false, error: 'Invalid ACP connect request.' };
  }
  const profile = request.profile;
  if (!profile || !profile.command.trim()) {
    return { ok: false, error: 'The selected ACP profile has no launch command.' };
  }
  const cwd = path.resolve(request.cwd || '');
  if (!request.cwd) return { ok: false, error: 'ACP sessions require a workspace.' };

  let entry = entries.get(request.sessionId);
  if (
    entry &&
    (entry.profile.id !== profile.id ||
      profileSignature(entry.profile) !== profileSignature(profile) ||
      entry.cwd.toLowerCase() !== cwd.toLowerCase())
  ) {
    entry.client.dispose();
    entries.delete(request.sessionId);
    entry = undefined;
  }
  if (!entry) {
    entry = createEntry(sender, {
      sessionId: request.sessionId,
      profile,
      cwd,
      permission: request.permission,
      prompt: '',
    });
  }
  entry.permission = request.permission || 'review';
  if (!entry.acpSessionId) {
    const launchIssue = launchPreflight(profile);
    if (launchIssue) {
      entry.client.dispose();
      entries.delete(request.sessionId);
      return { ok: false, error: launchIssue };
    }
    try {
      entry.acpSessionId = await startAgentSession(entry.client, profile, cwd);
    } catch (error) {
      entry.client.dispose();
      entries.delete(request.sessionId);
      return {
        ok: false,
        error: acpFailureHint(error instanceof Error ? error.message : String(error)),
      };
    }
  }
  const models = entry.client.getSessionModels(entry.acpSessionId);
  return { ok: true, models, capabilities: entry.client.getPromptCapabilities() };
}

async function setSessionModel(request: AcpSetModelRequest): Promise<AcpConnectResult> {
  if (!request || typeof request.sessionId !== 'string' || typeof request.modelId !== 'string') {
    return { ok: false, error: 'Invalid ACP model request.' };
  }
  const entry = entries.get(request.sessionId);
  if (!entry?.acpSessionId) {
    return { ok: false, error: 'Connect to the ACP agent before choosing a model.' };
  }
  try {
    const models = await entry.client.setModel(entry.acpSessionId, request.modelId);
    return {
      ok: true,
      models,
      capabilities: entry.client.getPromptCapabilities(),
    };
  } catch (error) {
    return {
      ok: false,
      error: acpFailureHint(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function registerAcpIpc(): void {
  ipcMain.handle('acp:prompt', (event, request: AcpPromptRequest) =>
    runPrompt(request, event.sender),
  );
  ipcMain.handle('acp:connect', (event, request: AcpConnectRequest) =>
    connectSession(request, event.sender),
  );
  ipcMain.handle('acp:setModel', (_event, request: AcpSetModelRequest) =>
    setSessionModel(request),
  );
  ipcMain.handle('acp:cancel', (_event, sessionId: string) => {
    const entry = entries.get(sessionId);
    if (entry?.acpSessionId) entry.client.cancel(entry.acpSessionId);
    setTimeout(() => {
      const current = entries.get(sessionId);
      if (current?.busy) disposeEntry(sessionId);
    }, 6_000);
  });
  ipcMain.handle('acp:dispose', (_event, sessionId: string) => {
    disposeEntry(sessionId);
  });
  ipcMain.handle('acp:registry', () => acpRegistry());
  ipcMain.handle('acp:health', (_event, command: string, args: string[]) =>
    checkAcpHealth(command, args || []),
  );
}