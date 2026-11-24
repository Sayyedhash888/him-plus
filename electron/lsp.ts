import { app, ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LspDiagnosticsEvent,
  LspDocumentInput,
  LspHover,
  LspLocation,
  LspServerStatus,
  LspStatus,
} from '../shared/types';
import { LspClient } from './lspClient';

interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  languages: string[];
}

interface RunningServer {
  config: ServerConfig;
  client: LspClient | null;
  error?: string;
  starting: Promise<void> | null;
}

const DEFAULT_SERVERS: ServerConfig[] = [
  {
    name: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    env: {},
    languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
  },
  {
    name: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    env: {},
    languages: ['python'],
  },
  {
    name: 'rust',
    command: 'rust-analyzer',
    args: [],
    env: {},
    languages: ['rust'],
  },
  { name: 'go', command: 'gopls', args: [], env: {}, languages: ['go'] },
  {
    name: 'clangd',
    command: 'clangd',
    args: [],
    env: {},
    languages: ['c', 'cpp', 'objective-c'],
  },
];

const servers = new Map<string, RunningServer>();
const languageToServer = new Map<string, string>();
const openDocuments = new Map<string, LspDocumentInput>();
let workspaceRoot = '';
let sender: WebContents | null = null;

function commandExists(command: string, root: string): boolean {
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(probe, [command], { windowsHide: true, stdio: 'ignore' });
    if (result.status === 0) return true;
  } catch {
    // fall through to local bin lookup
  }
  return localBinary(command, root) !== null;
}

/** Finds a language server binary installed in the workspace or app node_modules. */
function localBinary(command: string, root: string): string | null {
  if (!command || path.isAbsolute(command)) return null;
  const candidates: string[] = [];
  if (root) {
    candidates.push(
      path.join(root, 'node_modules', '.bin', command),
      path.join(root, 'node_modules', '.bin', `${command}.cmd`),
    );
  }
  try {
    const appPath = app.getAppPath();
    candidates.push(
      path.join(appPath, 'node_modules', '.bin', command),
      path.join(appPath, 'node_modules', '.bin', `${command}.cmd`),
    );
  } catch {
    // app path is unavailable in unit-test contexts
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function userConfigPath(): string {
  return path.join(app.getPath('userData'), 'lsp.json');
}

function projectConfigPath(root: string): string {
  return root ? path.join(root, '.him', 'lsp.json') : '';
}

function parseServerMap(raw: unknown): ServerConfig[] {
  if (!raw || typeof raw !== 'object') return [];
  const source = raw as Record<string, unknown>;
  const map = (source.servers ?? source) as Record<string, unknown>;
  if (!map || typeof map !== 'object') return [];
  const result: ServerConfig[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (item.enabled === false) continue;
    const command = typeof item.command === 'string' ? item.command.trim() : '';
    if (!command) continue;
    const languages = Array.isArray(item.languages)
      ? item.languages.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (languages.length === 0) continue;
    const args = Array.isArray(item.args)
      ? item.args.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const env: Record<string, string> = {};
    if (item.env && typeof item.env === 'object' && !Array.isArray(item.env)) {
      for (const [key, val] of Object.entries(item.env as Record<string, unknown>)) {
        if (typeof val === 'string' && key.trim()) env[key.trim()] = val;
      }
    }
    result.push({ name, command, args, env, languages });
  }
  return result;
}

function readConfigFile(filePath: string): ServerConfig[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return parseServerMap(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    console.warn('[lsp] could not read', filePath, (error as Error).message);
    return [];
  }
}

function resolveConfigs(root: string): ServerConfig[] {
  const configured = [
    ...readConfigFile(userConfigPath()),
    ...(root ? readConfigFile(projectConfigPath(root)) : []),
  ];
  const byName = new Map<string, ServerConfig>();
  for (const config of DEFAULT_SERVERS) {
    if (commandExists(config.command, root)) {
      byName.set(config.name, {
        ...config,
        command: localBinary(config.command, root) || config.command,
      });
    }
  }
  for (const config of configured) byName.set(config.name, config);
  return [...byName.values()];
}

function sendEvent(payload: LspDiagnosticsEvent): void {
  if (!sender || sender.isDestroyed()) return;
  sender.send('lsp:diagnostics', payload);
}

function buildStatus(): LspStatus {
  const statuses: LspServerStatus[] = [...servers.values()].map((server) => ({
    languageIds: server.config.languages,
    command: server.config.command,
    connected: Boolean(server.client?.connected),
    error: server.error,
  }));
  return {
    root: workspaceRoot,
    servers: statuses,
    configPath: userConfigPath(),
  };
}

async function ensureServer(languageId: string): Promise<LspClient | null> {
  const name = languageToServer.get(languageId);
  if (!name) return null;
  const server = servers.get(name);
  if (!server) return null;
  if (server.client?.connected) return server.client;
  if (server.starting) {
    await server.starting.catch(() => undefined);
    return server.client?.connected ? server.client : null;
  }
  const config = server.config;
  const client = new LspClient({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: workspaceRoot || process.cwd(),
    rootPath: workspaceRoot || process.cwd(),
    onDiagnostics: (filePath, diagnostics) => {
      sendEvent({ root: workspaceRoot, path: filePath, diagnostics });
    },
    onLog: (line, stream) => {
      if (stream === 'stderr' && line.trim()) {
        console.warn('[lsp]', config.name, line.trim().slice(0, 300));
      }
    },
  });
  server.client = client;
  server.error = undefined;
  server.starting = (async () => {
    try {
      await client.start();
      // Re-open documents that were already open before the server came up.
      for (const document of openDocuments.values()) {
        if (config.languages.includes(document.languageId)) {
          client.didOpen(document.path, document.languageId, document.text);
        }
      }
    } catch (error) {
      client.dispose();
      server.client = null;
      server.error = (error as Error).message;
      console.warn('[lsp]', config.name, 'failed to start:', server.error);
      throw error;
    } finally {
      server.starting = null;
    }
  })();
  try {
    await server.starting;
  } catch {
    return null;
  }
  return server.client?.connected ? server.client : null;
}

export async function setLspRoot(root: string, tab: WebContents): Promise<LspStatus> {
  sender = tab;
  const normalized = root || '';
  workspaceRoot = normalized;
  for (const server of servers.values()) {
    server.client?.dispose();
    server.client = null;
    server.error = undefined;
  }
  servers.clear();
  languageToServer.clear();
  openDocuments.clear();
  for (const config of resolveConfigs(normalized)) {
    servers.set(config.name, { config, client: null, starting: null });
    for (const language of config.languages) languageToServer.set(language, config.name);
  }
  return buildStatus();
}

export function getLspStatus(tab: WebContents): LspStatus {
  sender = tab;
  return buildStatus();
}

export async function lspOpenDocument(input: LspDocumentInput): Promise<void> {
  if (!input?.path || !input.languageId) return;
  openDocuments.set(input.path, input);
  const client = await ensureServer(input.languageId);
  client?.didOpen(input.path, input.languageId, input.text);
}

export async function lspChangeDocument(input: LspDocumentInput): Promise<void> {
  if (!input?.path) return;
  openDocuments.set(input.path, input);
  const client = await ensureServer(input.languageId);
  client?.didChange(input.path, input.text, input.version);
}

export async function lspCloseDocument(filePath: string): Promise<void> {
  const document = openDocuments.get(filePath);
  openDocuments.delete(filePath);
  if (!document) return;
  const name = languageToServer.get(document.languageId);
  const client = name ? servers.get(name)?.client : null;
  client?.didClose(filePath);
  sendEvent({ root: workspaceRoot, path: filePath, diagnostics: [] });
}

export async function lspHover(
  filePath: string,
  line: number,
  character: number,
): Promise<LspHover | null> {
  const document = openDocuments.get(filePath);
  if (!document) return null;
  const client = await ensureServer(document.languageId);
  if (!client) return null;
  return client.hover(filePath, {
    line: Math.max(0, line - 1),
    character: Math.max(0, character - 1),
  });
}

export async function lspDefinition(
  filePath: string,
  line: number,
  character: number,
): Promise<LspLocation[]> {
  const document = openDocuments.get(filePath);
  if (!document) return [];
  const client = await ensureServer(document.languageId);
  if (!client) return [];
  return client.definition(filePath, {
    line: Math.max(0, line - 1),
    character: Math.max(0, character - 1),
  });
}

export function disposeLsp(): void {
  for (const server of servers.values()) {
    server.client?.dispose();
    server.client = null;
  }
  servers.clear();
  languageToServer.clear();
  openDocuments.clear();
}

export function registerLspIpc(): void {
  ipcMain.handle('lsp:setRoot', (event, root: string) => setLspRoot(root || '', event.sender));
  ipcMain.handle('lsp:status', (event) => getLspStatus(event.sender));
  ipcMain.handle('lsp:openDocument', (_event, input: LspDocumentInput) =>
    lspOpenDocument(input),
  );
  ipcMain.handle('lsp:changeDocument', (_event, input: LspDocumentInput) =>
    lspChangeDocument(input),
  );
  ipcMain.handle('lsp:closeDocument', (_event, path: string) => lspCloseDocument(path));
  ipcMain.handle('lsp:hover', (_event, path: string, line: number, character: number) =>
    lspHover(path, line, character),
  );
  ipcMain.handle(
    'lsp:definition',
    (_event, path: string, line: number, character: number) =>
      lspDefinition(path, line, character),
  );
}
