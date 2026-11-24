import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type {
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspPosition,
} from '../shared/types';

/**
 * Minimal Language Server Protocol client over stdio (Content-Length framed
 * JSON-RPC 2.0). Electron-free by design so node:test can exercise it against a
 * mock server.
 */

export interface LspClientOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  rootPath: string;
  shell?: boolean;
  clientName?: string;
  clientVersion?: string;
  onDiagnostics(path: string, diagnostics: LspDiagnostic[]): void;
  onLog?(line: string, stream: 'stdout' | 'stderr'): void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const INIT_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;

export function fileUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).toString();
}

export function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function offsetToPosition(lineStarts: number[], offset: number): LspPosition {
  for (let index = lineStarts.length - 1; index >= 0; index -= 1) {
    if (offset >= lineStarts[index]) {
      return { line: index, character: offset - lineStarts[index] };
    }
  }
  return { line: 0, character: Math.max(0, offset) };
}

export function mapDiagnostics(raw: unknown): LspDiagnostic[] {
  if (!Array.isArray(raw)) return [];
  const diagnostics: LspDiagnostic[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const range = item.range as Record<string, unknown> | undefined;
    const start = range?.start as Record<string, unknown> | undefined;
    const end = range?.end as Record<string, unknown> | undefined;
    const message = typeof item.message === 'string' ? item.message : '';
    if (!message) continue;
    const severityRaw = typeof item.severity === 'number' ? item.severity : 3;
    const severity = (severityRaw >= 1 && severityRaw <= 4 ? severityRaw : 3) as 1 | 2 | 3 | 4;
    const code =
      typeof item.code === 'string'
        ? item.code
        : typeof item.code === 'number'
          ? String(item.code)
          : undefined;
    diagnostics.push({
      line: typeof start?.line === 'number' ? start.line + 1 : 1,
      column: typeof start?.character === 'number' ? start.character + 1 : 1,
      endLine: typeof end?.line === 'number' ? end.line + 1 : 1,
      endColumn: typeof end?.character === 'number' ? end.character + 1 : 1,
      message,
      severity,
      source: typeof item.source === 'string' ? item.source : undefined,
      code,
    });
  }
  return diagnostics;
}

export function extractHover(raw: unknown): LspHover | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const contents = entry.contents;
  const parts: string[] = [];
  if (typeof contents === 'string') parts.push(contents);
  else if (contents && typeof contents === 'object' && !Array.isArray(contents)) {
    const record = contents as Record<string, unknown>;
    if (typeof record.value === 'string') parts.push(record.value);
    else if (typeof record.language === 'string') parts.push(`\`\`\`${record.language}`);
  } else if (Array.isArray(contents)) {
    for (const part of contents) {
      if (typeof part === 'string') parts.push(part);
      else if (part && typeof part === 'object') {
        const value = (part as Record<string, unknown>).value;
        if (typeof value === 'string') parts.push(value);
      }
    }
  }
  const markdown = parts.join('\n\n').trim();
  if (!markdown) return null;
  return { contents: markdown };
}

export function extractLocations(raw: unknown): LspLocation[] {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const locations: LspLocation[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const uri = typeof record.uri === 'string' ? record.uri : '';
    const range = record.range as Record<string, unknown> | undefined;
    const start = range?.start as Record<string, unknown> | undefined;
    const end = range?.end as Record<string, unknown> | undefined;
    if (!uri || !start || !end) continue;
    locations.push({
      path: uriToPath(uri),
      range: {
        start: {
          line: typeof start.line === 'number' ? start.line + 1 : 1,
          character: typeof start.character === 'number' ? start.character + 1 : 1,
        },
        end: {
          line: typeof end.line === 'number' ? end.line + 1 : 1,
          character: typeof end.character === 'number' ? end.character + 1 : 1,
        },
      },
    });
  }
  return locations;
}

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

export class LspClient {
  private readonly options: LspClientOptions;
  private child: ChildProcess | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private ready = false;
  private disposed = false;
  private capabilities: Record<string, unknown> = {};
  private diagnosticsDisposable: boolean = true;

  constructor(options: LspClientOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.ready && !!this.child && this.child.exitCode === null;
  }

  get serverCapabilities(): Record<string, unknown> {
    return this.capabilities;
  }

  async start(timeoutMs = INIT_TIMEOUT_MS): Promise<void> {
    if (this.connected) return;
    if (this.disposed) throw new Error('This LSP client has been disposed.');
    this.ready = false;
    this.diagnosticsDisposable = true;
    const child = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.env || {}) },
      shell: this.options.shell ?? process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.options.onLog?.(chunk, 'stderr'));
    child.on('error', (error) => this.failPending(error));
    child.on('exit', (code, signal) => {
      this.ready = false;
      this.failPending(
        new Error(`Language server exited (${signal || code || 'unknown'}).`),
      );
    });

    const rootUri = fileUri(this.options.rootPath);
    const result = (await this.request(
      'initialize',
      {
        processId: process.pid,
        clientInfo: {
          name: this.options.clientName || 'him-plus',
          version: this.options.clientVersion || '0.1.0',
        },
        rootUri,
        rootPath: path.resolve(this.options.rootPath),
        workspaceFolders: [{ uri: rootUri, name: path.basename(this.options.rootPath) }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: false },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: false,
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            publishDiagnostics: { relatedInformation: true, versionSupport: false },
          },
        },
        initializationOptions: {},
      },
      timeoutMs,
    )) as Record<string, unknown>;
    this.capabilities =
      result?.capabilities && typeof result.capabilities === 'object'
        ? (result.capabilities as Record<string, unknown>)
        : {};
    this.notify('initialized', {});
    this.ready = true;
  }

  didOpen(filePath: string, languageId: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { uri: fileUri(filePath), languageId, version: 1, text },
    });
  }

  didChange(filePath: string, text: string, version: number): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri: fileUri(filePath), version },
      contentChanges: [{ text }],
    });
  }

  didClose(filePath: string): void {
    this.notify('textDocument/didClose', { textDocument: { uri: fileUri(filePath) } });
  }

  async hover(filePath: string, position: LspPosition): Promise<LspHover | null> {
    try {
      const result = await this.request('textDocument/hover', {
        textDocument: { uri: fileUri(filePath) },
        position: { line: position.line, character: position.character },
      });
      return extractHover(result);
    } catch {
      return null;
    }
  }

  async definition(filePath: string, position: LspPosition): Promise<LspLocation[]> {
    try {
      const result = await this.request('textDocument/definition', {
        textDocument: { uri: fileUri(filePath) },
        position: { line: position.line, character: position.character },
      });
      return extractLocations(result);
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.diagnosticsDisposable = false;
    killTree(this.child);
    this.child = null;
    this.failPending(new Error('The language server was disposed.'));
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(payload: unknown): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    try {
      stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      stdin.write(body);
    } catch {
      // The exit handler reports the failure.
    }
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const child = this.child;
      if (!child || this.disposed) {
        reject(new Error(`${method} failed: the language server is not running.`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, Math.max(1_000, timeoutMs));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header);
      const bodyStart = headerEnd + 4;
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(bodyStart);
        continue;
      }
      const length = Number(lengthMatch[1]);
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // Ignore malformed payloads rather than killing the session.
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id as number | string | undefined;
    const method = typeof message.method === 'string' ? message.method : '';
    if (id !== undefined && !method) {
      const pending = this.pending.get(Number(id));
      if (!pending) return;
      this.pending.delete(Number(id));
      clearTimeout(pending.timer);
      const error = message.error as Record<string, unknown> | undefined;
      if (error) {
        pending.reject(new Error(String(error.message || 'LSP request failed')));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (!method) return;
    if (method === 'textDocument/publishDiagnostics') {
      const params = (message.params || {}) as Record<string, unknown>;
      const uri = typeof params.uri === 'string' ? params.uri : '';
      if (!uri || !this.diagnosticsDisposable) return;
      this.options.onDiagnostics(uriToPath(uri), mapDiagnostics(params.diagnostics));
      return;
    }
    if (id === undefined) return; // other notifications are safe to ignore
    // Server-to-client requests: answer defensively so the server never hangs.
    if (method === 'workspace/configuration') {
      const params = (message.params || {}) as Record<string, unknown>;
      const items = Array.isArray(params.items) ? params.items : [];
      this.write({ jsonrpc: '2.0', id, result: items.map(() => null) });
      return;
    }
    if (method === 'workspace/workspaceFolders') {
      this.write({
        jsonrpc: '2.0',
        id,
        result: [
          {
            uri: fileUri(this.options.rootPath),
            name: path.basename(this.options.rootPath),
          },
        ],
      });
      return;
    }
    this.write({ jsonrpc: '2.0', id, result: null });
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export { offsetToPosition };
