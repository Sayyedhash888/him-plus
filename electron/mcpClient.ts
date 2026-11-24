import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * Minimal MCP (Model Context Protocol) stdio client.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over the server's stdio, as
 * specified by the MCP stdio transport. Kept free of Electron imports so the
 * protocol layer can be exercised by node:test with a mock server.
 */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallOutcome {
  text: string;
  isError: boolean;
}

export interface McpClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
  clientName?: string;
  clientVersion?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_INIT_TIMEOUT_MS = 15_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

function killTree(child: ChildProcess | null): void {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

export function flattenMcpContent(result: unknown): McpCallOutcome {
  const record = (result || {}) as { content?: unknown; isError?: unknown };
  const blocks = Array.isArray(record.content) ? record.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const item = block as { type?: string; text?: string; resource?: { uri?: string } };
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (item.type === 'image') parts.push('[image content returned by the MCP tool was omitted]');
    else if (item.type === 'resource') parts.push(`[resource: ${item.resource?.uri || 'unknown'}]`);
    else parts.push(JSON.stringify(block).slice(0, 2_000));
  }
  if (parts.length === 0 && record.content !== undefined && !Array.isArray(record.content)) {
    parts.push(
      typeof record.content === 'string' ? record.content : JSON.stringify(record.content),
    );
  }
  return { text: parts.join('\n').trim() || '(no output)', isError: record.isError === true };
}

export class McpStdioClient {
  private readonly options: McpClientOptions;
  private child: ChildProcess | null = null;
  private buffer = '';
  private stderrTail = '';
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private ready = false;
  private disposed = false;

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.ready && !!this.child && this.child.exitCode === null;
  }

  get lastStderr(): string {
    return this.stderrTail.trim();
  }

  async start(timeoutMs = DEFAULT_INIT_TIMEOUT_MS): Promise<void> {
    if (this.connected) return;
    if (this.disposed) throw new Error('This MCP client has been disposed.');
    this.ready = false;
    this.stderrTail = '';
    const child = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd || process.cwd(),
      env: { ...process.env, ...(this.options.env || {}) },
      shell: this.options.shell ?? process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000);
    });
    child.on('error', (error) => this.failAll(error));
    child.on('exit', () => {
      this.ready = false;
      this.failAll(new Error(this.stderrTail || 'The MCP server exited.'));
    });

    await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: this.options.clientName || 'him-plus',
          version: this.options.clientVersion || '0.1.0',
        },
      },
      timeoutMs,
    );
    this.notify('notifications/initialized', {});
    this.ready = true;
  }

  async listTools(timeoutMs = DEFAULT_INIT_TIMEOUT_MS): Promise<McpToolDefinition[]> {
    const result = (await this.request('tools/list', {}, timeoutMs)) as {
      tools?: McpToolDefinition[];
    };
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  ): Promise<McpCallOutcome> {
    const result = await this.request(
      'tools/call',
      { name, arguments: args || {} },
      timeoutMs,
    );
    return flattenMcpContent(result);
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    killTree(this.child);
    this.child = null;
    this.failAll(new Error('The MCP client was disposed.'));
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(payload: unknown): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    try {
      stdin.write(`${JSON.stringify(payload)}\n`);
    } catch {
      // The server may have exited; the request timeout reports it.
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.child || this.child.exitCode !== null) {
        reject(new Error(`${method} failed: the MCP server is not running.`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, Math.max(1_000, timeoutMs));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // servers may log plain text on stdout; ignore unparseable lines
    }
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(
            `${message.error.message || 'MCP request failed'}${message.error.code ? ` (code ${message.error.code})` : ''}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && typeof message.method === 'string') {
      this.handleServerRequest(Number(message.id), message.method, message.params);
    }
  }

  private handleServerRequest(id: number, method: string, params: unknown): void {
    if (method === 'roots/list') {
      this.write({ jsonrpc: '2.0', id, result: { roots: [] } });
      return;
    }
    if (method === 'ping') {
      this.write({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    this.write({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `HIM+ does not provide "${method}" capabilities to MCP servers.`,
      },
    });
    void params;
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
