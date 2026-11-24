import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  McpCallInput,
  McpCallResult,
  McpServerStatus,
  McpStatus,
  McpToolInfo,
} from '../shared/types';
import { McpStdioClient } from './mcpClient';

interface ServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

interface RunningServer {
  name: string;
  config: ServerConfig;
  client: McpStdioClient | null;
  tools: McpToolInfo[];
  error?: string;
}

const servers = new Map<string, RunningServer>();
let loadedRoot: string | null = null;
let activeLoad: Promise<void> | null = null;
let activeLoadRoot = '';

function userConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp.json');
}

function projectConfigPath(root: string): string {
  return root ? path.join(root, '.him', 'mcp.json') : '';
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function qualifiedName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

function parseConfigFile(filePath: string): Record<string, ServerConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const list = (raw?.mcpServers ?? raw?.servers ?? raw) as Record<string, unknown> | undefined;
    if (!list || typeof list !== 'object') return {};
    const result: Record<string, ServerConfig> = {};
    for (const [rawName, rawValue] of Object.entries(list)) {
      const name = sanitizeName(rawName);
      if (!name || !rawValue) continue;
      const config: ServerConfig = { command: '', args: [], env: {} };
      if (typeof rawValue === 'string') {
        const parts = rawValue.trim().split(/\s+/);
        config.command = parts.shift() || '';
        config.args = parts;
      } else if (rawValue && typeof rawValue === 'object') {
        const item = rawValue as Record<string, unknown>;
        if (item.disabled === true) continue;
        config.command = typeof item.command === 'string' ? item.command.trim() : '';
        config.args = Array.isArray(item.args)
          ? item.args.filter((arg): arg is string => typeof arg === 'string')
          : [];
        if (item.env && typeof item.env === 'object' && !Array.isArray(item.env)) {
          for (const [key, value] of Object.entries(item.env as Record<string, unknown>)) {
            if (typeof value === 'string' && key.trim()) config.env[key.trim()] = value;
          }
        }
        if (typeof item.cwd === 'string' && item.cwd.trim()) config.cwd = item.cwd.trim();
      }
      if (config.command) result[name] = config;
    }
    return result;
  } catch {
    return {};
  }
}

async function startServer(entry: RunningServer, root: string): Promise<void> {
  const client = new McpStdioClient({
    command: entry.config.command,
    args: entry.config.args,
    env: entry.config.env,
    cwd: entry.config.cwd || root || undefined,
    shell: process.platform === 'win32',
    clientName: 'him-plus',
    clientVersion: app.getVersion?.() || '0.1.0',
  });
  try {
    await client.start();
    const tools = await client.listTools();
    entry.tools = tools
      .filter((tool) => tool && typeof tool.name === 'string' && tool.name.trim())
      .map((tool) => ({
        server: entry.name,
        name: tool.name,
        qualifiedName: qualifiedName(entry.name, tool.name),
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === 'object'
            ? tool.inputSchema
            : { type: 'object', properties: {}, required: [] },
      }));
    entry.client = client;
    entry.error = undefined;
  } catch (error) {
    client.dispose();
    entry.client = null;
    entry.tools = [];
    entry.error = (error as Error).message || 'The MCP server failed to start.';
  }
}

async function ensureServers(root: string, force = false): Promise<void> {
  const normalizedRoot = root || '';
  if (!force && loadedRoot === normalizedRoot && servers.size > 0) return;
  if (activeLoad && activeLoadRoot === normalizedRoot) return activeLoad;
  activeLoadRoot = normalizedRoot;
  activeLoad = (async () => {
    for (const entry of servers.values()) entry.client?.dispose();
    servers.clear();
    loadedRoot = normalizedRoot;
    const merged: Record<string, ServerConfig> = {
      ...parseConfigFile(userConfigPath()),
    };
    if (normalizedRoot) {
      Object.assign(merged, parseConfigFile(projectConfigPath(normalizedRoot)));
    }
    for (const [name, config] of Object.entries(merged)) {
      servers.set(name, { name, config, client: null, tools: [] });
    }
    await Promise.all([...servers.values()].map((entry) => startServer(entry, normalizedRoot)));
  })().finally(() => {
    activeLoad = null;
    activeLoadRoot = '';
  });
  return activeLoad;
}

function buildStatus(root: string): McpStatus {
  const statuses: McpServerStatus[] = [...servers.values()].map((entry) => ({
    name: entry.name,
    command: entry.config.command,
    connected: Boolean(entry.client?.connected),
    error: entry.error,
    tools: entry.tools,
  }));
  return {
    servers: statuses,
    userConfigPath: userConfigPath(),
    projectConfigPath: projectConfigPath(root),
  };
}

export async function getMcpStatus(root: string): Promise<McpStatus> {
  await ensureServers(root);
  return buildStatus(root);
}

export async function reloadMcp(root: string): Promise<McpStatus> {
  await ensureServers(root, true);
  return buildStatus(root);
}

export async function callMcpTool(input: McpCallInput): Promise<McpCallResult> {
  if (!input || typeof input.server !== 'string' || typeof input.tool !== 'string') {
    throw new Error('Invalid MCP tool call.');
  }
  await ensureServers(input.root || '');
  const server = servers.get(sanitizeName(input.server));
  if (!server) {
    throw new Error(`No MCP server named "${input.server}" is configured for this workspace.`);
  }
  if (!server.client?.connected) {
    throw new Error(
      `MCP server "${input.server}" is not connected.${server.error ? ` ${server.error}` : ''}`,
    );
  }
  const tool = server.tools.find((item) => item.name === input.tool);
  if (!tool) {
    throw new Error(`MCP server "${input.server}" does not expose a tool named "${input.tool}".`);
  }
  const outcome = await server.client.callTool(tool.name, input.arguments || {});
  return { text: outcome.text, isError: outcome.isError };
}

export async function getMcpServerConfigs(
  root: string,
): Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string> }>> {
  await ensureServers(root);
  const configs: Array<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  }> = [];
  for (const entry of servers.values()) {
    if (!entry.client?.connected || !entry.config.command) continue;
    configs.push({
      name: entry.name,
      command: entry.config.command,
      args: [...entry.config.args],
      env: { ...entry.config.env },
    });
  }
  return configs;
}

export function disposeMcpClients(): void {
  for (const entry of servers.values()) entry.client?.dispose();
  servers.clear();
  loadedRoot = null;
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:status', (_event, root: string) => getMcpStatus(root || ''));
  ipcMain.handle('mcp:reload', (_event, root: string) => reloadMcp(root || ''));
  ipcMain.handle('mcp:call', (_event, input: McpCallInput) => callMcpTool(input));
}
