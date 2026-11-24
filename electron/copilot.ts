import { app, ipcMain, shell } from 'electron';
import type { WebContents } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  CopilotCompletionInput,
  CopilotCompletionResult,
  CopilotSignInResult,
  CopilotStatus,
} from '../shared/types';
import {
  parseCopilotSignInResponse,
  parseCopilotStatusNotification,
} from '../shared/copilotAuth';
import { CopilotConnection } from './copilotConnection';

/**
 * GitHub Copilot inline-completion integration.
 *
 * Uses the official @github/copilot-language-server (the same server the
 * Neovim/JetBrains plugins use) over stdio, with GitHub device-flow sign-in.
 * Sign-in/token storage is handled by the server itself; HIM+ only relays it.
 */

interface CopilotSession {
  connection: CopilotConnection;
  child: ChildProcessWithoutNullStreams;
  root: string;
  status: CopilotStatus;
  documents: Map<string, { version: number; text: string; languageId: string }>;
}

let session: CopilotSession | null = null;
let statusSender: WebContents | null = null;

const TOKEN_FILE_HINT = 'https://github.com/login/device';
const MIN_NODE = { major: 22, minor: 13 };

/**
 * The Copilot language server requires Node.js >= 22.13. Electron's embedded
 * Node is older (Electron 33 ships Node 20), so prefer the user's system Node.
 */
function resolveNodeBinary(): { binary: string; version: string } {
  const candidates: string[] = [];
  try {
    const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    for (const line of String(probe.stdout || '').split(/\r?\n/)) {
      if (line.trim()) candidates.push(line.trim());
    }
  } catch {
    // fall through to Electron's bundled node
  }
  candidates.push(process.execPath);
  for (const binary of candidates) {
    try {
      const result = spawnSync(binary, ['-p', 'process.versions.node'], {
        windowsHide: true,
        encoding: 'utf8',
        env:
          binary === process.execPath
            ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
            : process.env,
      });
      const version = String(result.stdout || '').trim();
      const match = /^(\d+)\.(\d+)\./.exec(version);
      if (!match) continue;
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor)) {
        return { binary, version };
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `GitHub Copilot requires Node.js ${MIN_NODE.major}.${MIN_NODE.minor}+ on PATH, but none was found. Install a current Node.js and restart HIM+.`,
  );
}

function serverScript(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'node_modules', '@github', 'copilot-language-server', 'dist', 'language-server.js'),
    path.join(process.cwd(), 'node_modules', '@github', 'copilot-language-server', 'dist', 'language-server.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function rootUri(root: string): string {
  return pathToFileURL(path.resolve(root)).toString();
}

function defaultStatus(available: boolean): CopilotStatus {
  return {
    running: false,
    serverAvailable: available,
    signedIn: false,
    kind: 'unknown',
    message: available
      ? 'Not signed in. Sign in with your GitHub Copilot account.'
      : 'Copilot language server not installed.',
  };
}

function publishStatus(status: CopilotStatus): void {
  if (session) session.status = status;
  if (statusSender && !statusSender.isDestroyed()) {
    statusSender.send('copilot:status', status);
  }
}

function statusValue(): CopilotStatus {
  if (session) return session.status;
  return defaultStatus(serverScript() !== null);
}

async function ensureSession(root: string): Promise<CopilotSession> {
  if (session) {
    if (root && session.root !== root) {
      await disposeCopilotSession();
    } else {
      return session;
    }
  }
  const script = serverScript();
  if (!script) {
    throw new Error(
      'The GitHub Copilot language server is not installed. Run "npm install @github/copilot-language-server" (or reinstall HIM+).',
    );
  }
  const workspace = path.resolve(root || app.getPath('documents'));
  const node = resolveNodeBinary();
  const child = spawn(node.binary, [script, '--stdio'], {
    cwd: workspace,
    env: node.binary === process.execPath
      ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      : process.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const line = chunk.trim();
    if (line) console.warn('[copilot]', line.slice(0, 500));
  });
  const connection = new CopilotConnection();
  connection.attachStdio(child.stdin, child.stdout);

  const newSession: CopilotSession = {
    connection,
    child,
    root: workspace,
    status: {
      running: true,
      serverAvailable: true,
      signedIn: false,
      kind: 'Starting',
      message: 'Starting Copilot language server…',
    },
    documents: new Map(),
  };
  session = newSession;

  connection.onNotification((method, params) => {
    const parsed = parseCopilotStatusNotification(method, params);
    if (parsed) {
      const previous = session?.status;
      publishStatus({
        running: true,
        serverAvailable: true,
        signedIn: parsed.signedIn ?? previous?.signedIn ?? false,
        kind: parsed.kind || previous?.kind || 'Normal',
        message: parsed.message || previous?.message || '',
        busy: parsed.busy ?? previous?.busy,
        user: parsed.user || previous?.user,
        completionsPercentRemaining:
          parsed.completionsPercentRemaining ?? previous?.completionsPercentRemaining,
      });
    }
    if (method === 'window/logMessage') {
      const payload = (params || {}) as Record<string, unknown>;
      if (typeof payload.message === 'string') {
        console.warn('[copilot]', payload.message.slice(0, 500));
      }
    }
  });
  connection.onRequest((method, params) => {
    if (method === 'window/showDocument') {
      const payload = (params || {}) as Record<string, unknown>;
      const uri = typeof payload.uri === 'string' ? payload.uri : '';
      if (uri.startsWith('https://') || uri.startsWith('http://')) {
        void shell.openExternal(uri);
      }
      return { result: { success: true } };
    }
    if (method === 'workspace/configuration') {
      const payload = (params || {}) as Record<string, unknown>;
      const items = Array.isArray(payload.items) ? payload.items : [];
      return { result: items.map(() => null) };
    }
    if (method === 'workspace/workspaceFolders') {
      return {
        result: [{ uri: rootUri(workspace), name: path.basename(workspace) }],
      };
    }
    return { result: null };
  });
  child.on('exit', () => {
    if (session === newSession) {
      session = null;
      publishStatus({
        running: false,
        serverAvailable: true,
        signedIn: false,
        kind: 'Stopped',
        message: 'Copilot language server stopped.',
      });
    }
  });

  await connection.request('initialize', {
    processId: process.pid,
    clientInfo: { name: 'HIM+', version: '0.1.0' },
    workspaceFolders: [{ uri: rootUri(workspace), name: path.basename(workspace) }],
    capabilities: {
      workspace: { workspaceFolders: true },
      textDocument: {
        synchronization: { dynamicRegistration: false },
        inlineCompletion: { dynamicRegistration: false },
      },
    },
    initializationOptions: {
      editorInfo: { name: 'HIM+', version: app.getVersion() },
      editorPluginInfo: { name: 'HIM+ Copilot FIM', version: app.getVersion() },
    },
  });
  connection.notify('initialized', {});
  connection.notify('workspace/didChangeConfiguration', {
    settings: { telemetry: { telemetryLevel: 'off' } },
  });
  publishStatus({
    running: true,
    serverAvailable: true,
    signedIn: newSession.status.signedIn,
    kind: 'Normal',
    message: 'Connected. Sign in with GitHub Copilot if prompted.',
  });
  return newSession;
}

function syncDocument(
  current: CopilotSession,
  input: { path: string; text: string; languageId: string; version: number },
): void {
  const uri = pathToFileURL(path.resolve(input.path)).toString();
  const previous = current.documents.get(input.path);
  if (!previous) {
    current.connection.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: input.languageId || 'plaintext',
        version: input.version,
        text: input.text,
      },
    });
    current.connection.notify('textDocument/didFocus', { textDocument: { uri } });
  } else if (previous.version !== input.version || previous.text !== input.text) {
    current.connection.notify('textDocument/didChange', {
      textDocument: { uri, version: input.version },
      contentChanges: [{ text: input.text }],
    });
  }
  current.documents.set(input.path, {
    version: input.version,
    text: input.text,
    languageId: input.languageId,
  });
}

export async function copilotSetRoot(root: string, sender: WebContents): Promise<CopilotStatus> {
  statusSender = sender;
  if (!root) return statusValue();
  try {
    await ensureSession(root);
  } catch (error) {
    publishStatus({
      running: false,
      serverAvailable: serverScript() !== null,
      signedIn: false,
      kind: 'Error',
      message: (error as Error).message,
    });
  }
  return statusValue();
}

export function copilotStatus(sender: WebContents): CopilotStatus {
  statusSender = sender;
  return statusValue();
}

export async function copilotSignIn(root: string): Promise<CopilotSignInResult> {
  try {
    const current = await ensureSession(root);
    const response = await current.connection.request('signIn', {});
    const parsed = parseCopilotSignInResponse(response);
    if (parsed.alreadySignedIn) {
      publishStatus({
        running: true,
        serverAvailable: true,
        signedIn: true,
        kind: 'Normal',
        message: parsed.user
          ? `Signed in as ${parsed.user}.`
          : 'Already signed in to GitHub Copilot.',
        user: parsed.user,
      });
      return {
        ok: true,
        signedIn: true,
        user: parsed.user,
        message: parsed.user
          ? `Already signed in as ${parsed.user}.`
          : 'Already signed in to GitHub Copilot.',
      };
    }
    if (parsed.command) {
      // Opening the browser must not block the UI: the server may keep this
      // request open until the device flow finishes.
      void current.connection
        .request('workspace/executeCommand', {
          command: parsed.command.command,
          arguments: parsed.command.arguments,
        })
        .catch(() => undefined);
    }
    return {
      ok: true,
      userCode: parsed.userCode,
      verificationUri: TOKEN_FILE_HINT,
      message: parsed.userCode
        ? `Enter code ${parsed.userCode} at github.com/login/device.`
        : undefined,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function copilotSignOut(): Promise<void> {
  if (!session) return;
  await session.connection.request('signOut', {}).catch(() => undefined);
  publishStatus({
    running: true,
    serverAvailable: true,
    signedIn: false,
    kind: 'Error',
    message: 'Signed out of GitHub Copilot.',
  });
}

/**
 * Functional authentication probe: asks Copilot for a completion on a
 * completion-friendly snippet. The server does not expose an auth query, and it
 * silently returns no items when signed out — non-empty items mean the account
 * is authenticated and receiving suggestions.
 */
export async function copilotVerifyAuth(): Promise<{ signedIn: boolean; message: string }> {
  let current = session;
  if (!current) {
    try {
      current = await ensureSession(session?.root || '');
    } catch (error) {
      return { signedIn: false, message: (error as Error).message };
    }
  }
  if (!current) return { signedIn: false, message: 'Copilot language server is not running.' };
  if (current.status.signedIn) {
    return {
      signedIn: true,
      message: current.status.user
        ? `Signed in as ${current.status.user}.`
        : 'Signed in to GitHub Copilot.',
    };
  }
  // Sign-in notifications can arrive a moment after the request returns.
  for (let attempt = 0; attempt < 12 && !current.status.signedIn; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (current.status.signedIn) {
    return {
      signedIn: true,
      message: current.status.user
        ? `Signed in as ${current.status.user}.`
        : 'Signed in to GitHub Copilot.',
    };
  }
  const root = current.root || app.getPath('documents');
  const probePath = path.join(root, '.him-copilot-probe.py');
  const text = 'def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n';
  try {
    const uri = pathToFileURL(probePath).toString();
    current.connection.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'python', version: 1, text },
    });
    let sawItem = false;
    for (let attempt = 0; attempt < 3 && !sawItem; attempt += 1) {
      const result = (await current.connection.request(
        'textDocument/inlineCompletion',
        {
          textDocument: { uri, version: 1 },
          position: { line: 3, character: 4 },
          context: { triggerKind: 2 },
          formattingOptions: { tabSize: 2, insertSpaces: true },
        },
        12_000,
      )) as { items?: Array<{ insertText?: string }> };
      sawItem = Array.isArray(result?.items) && result.items.some((item) => Boolean(item.insertText));
      if (!sawItem) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    current.connection.notify('textDocument/didClose', { textDocument: { uri } });
    if (sawItem) {
      publishStatus({
        running: true,
        serverAvailable: true,
        signedIn: true,
        kind: 'Normal',
        message: 'Signed in — Copilot is serving suggestions.',
      });
      return { signedIn: true, message: 'Signed in — Copilot is serving suggestions.' };
    }
    publishStatus({
      running: true,
      serverAvailable: true,
      signedIn: false,
      kind: 'Error',
      message: 'No suggestions returned (sign-in incomplete, quota exhausted, or no suggestion for the probe).',
    });
    return {
      signedIn: false,
      message:
        'No suggestions returned. Finish the GitHub device flow, or check Copilot subscription/quota, then try again.',
    };
  } catch (error) {
    return { signedIn: false, message: (error as Error).message };
  }
}

export async function copilotComplete(
  input: CopilotCompletionInput,
): Promise<CopilotCompletionResult | null> {
  if (!input || typeof input.path !== 'string' || typeof input.text !== 'string') return null;
  const notice = defaultStatus(serverScript() !== null);
  if (!session) {
    try {
      await ensureSession(path.dirname(input.path));
    } catch {
      publishStatus(notice);
      return null;
    }
  }
  const current = session;
  if (!current) return null;
  try {
    syncDocument(current, {
      path: input.path,
      text: input.text,
      languageId: input.languageId,
      version: input.version,
    });
    const uri = pathToFileURL(path.resolve(input.path)).toString();
    const result = (await current.connection.request(
      'textDocument/inlineCompletion',
      {
        textDocument: { uri, version: input.version },
        position: {
          line: Math.max(0, input.line - 1),
          character: Math.max(0, input.character - 1),
        },
        context: { triggerKind: input.triggerKind ?? 2 },
        formattingOptions: { tabSize: 2, insertSpaces: true },
      },
      12_000,
    )) as { items?: Array<Record<string, unknown>> };
    const item = Array.isArray(result?.items) ? result.items[0] : undefined;
    if (!item || typeof item.insertText !== 'string' || !item.insertText.trim()) return null;
    // Shown telemetry + acceptance command are relayed with the result.
    current.connection.notify('textDocument/didShowCompletion', { item });
    let range: CopilotCompletionResult['range'];
    const rawRange = item.range as Record<string, unknown> | undefined;
    const start = rawRange?.start as Record<string, unknown> | undefined;
    const end = rawRange?.end as Record<string, unknown> | undefined;
    if (
      typeof start?.line === 'number' &&
      typeof start?.character === 'number' &&
      typeof end?.line === 'number' &&
      typeof end?.character === 'number'
    ) {
      range = {
        startLine: start.line + 1,
        startColumn: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
      };
    }
    const command = item.command as Record<string, unknown> | undefined;
    return {
      text: item.insertText,
      range,
      command:
        command && typeof command.command === 'string'
          ? {
              command: command.command,
              arguments: Array.isArray(command.arguments) ? command.arguments : [],
            }
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function copilotAccept(
  command: { command: string; arguments?: unknown[] } | undefined,
): Promise<void> {
  if (!session || !command || typeof command.command !== 'string') return;
  await session.connection
    .request('workspace/executeCommand', {
      command: command.command,
      arguments: Array.isArray(command.arguments) ? command.arguments : [],
    })
    .catch(() => undefined);
}

export async function disposeCopilotSession(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  try {
    current.connection.notify('exit', {});
  } catch {
    // ignore
  }
  current.connection.dispose();
  try {
    current.child.kill();
  } catch {
    // ignore
  }
}

export function registerCopilotIpc(): void {
  ipcMain.handle('copilot:status', (event) => copilotStatus(event.sender));
  ipcMain.handle('copilot:setRoot', (event, root: string) =>
    copilotSetRoot(root || '', event.sender),
  );
  ipcMain.handle('copilot:signIn', (_event, root: string) => copilotSignIn(root || ''));
  ipcMain.handle('copilot:signOut', () => copilotSignOut());
  ipcMain.handle('copilot:verifyAuth', () => copilotVerifyAuth());
  ipcMain.handle('copilot:complete', (_event, input: CopilotCompletionInput) =>
    copilotComplete(input),
  );
  ipcMain.handle(
    'copilot:accept',
    (_event, command: { command: string; arguments?: unknown[] } | undefined) =>
      copilotAccept(command),
  );
}
