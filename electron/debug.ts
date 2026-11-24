import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DebugRequestInput,
  DebugSessionStatus,
  DebugStartRequest,
  DebugStartResult,
} from '../shared/types';
import { DapClient } from './dapClient';

interface DebugSession {
  client: DapClient;
  child: ChildProcessWithoutNullStreams;
  sender: WebContents | null;
}

let session: DebugSession | null = null;

const ALLOWED_COMMANDS = new Set([
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'pause',
  'threads',
  'stackTrace',
  'scopes',
  'variables',
  'evaluate',
  'setBreakpoints',
  'configurationDone',
  'disconnect',
]);

function pythonAvailable(): boolean {
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(probe, ['python'], { windowsHide: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function killTree(child: ChildProcessWithoutNullStreams | null): void {
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

function resolveInside(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Debug target must be inside the workspace.');
  }
  return resolved;
}

export async function startDebugSession(
  request: DebugStartRequest,
  sender: WebContents,
): Promise<DebugStartResult> {
  await stopDebugSession();
  if (!request || typeof request.file !== 'string' || !request.file.trim()) {
    return { ok: false, error: 'Open a Python file before starting a debug session.' };
  }
  if (!pythonAvailable()) {
    return {
      ok: false,
      error: 'Python is not on PATH. Install Python and debugpy (pip install debugpy) to debug.',
    };
  }
  let filePath: string;
  try {
    filePath = resolveInside(request.workspace, request.file);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `File does not exist: ${filePath}` };
  }
  if (!/\.py$/i.test(filePath)) {
    return {
      ok: false,
      error: 'Only Python files are supported by the built-in debugger (debugpy).',
    };
  }

  const cwd = request.workspace || path.dirname(filePath);
  // debugpy's adapter speaks DAP over stdio; it launches the target itself.
  const child = spawn('python', ['-Xfrozen_modules=off', '-m', 'debugpy.adapter'], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (sender.isDestroyed()) return;
    const line = String(chunk).trim();
    if (line) sender.send('debug:log', { line: `${line}\n` });
  });
  child.on('exit', () => {
    if (session?.child === child) session = null;
  });

  const client = new DapClient({
    onEvent: (event, body) => {
      if (!sender.isDestroyed()) sender.send('debug:event', { event, body });
    },
    onLog: (line) => {
      if (!sender.isDestroyed()) sender.send('debug:log', { line: `${line}\n` });
    },
  });
  client.attachStdio(child.stdin, child.stdout);
  session = { client, child, sender };

  try {
    await client.request('initialize', {
      clientID: 'him-plus',
      clientName: 'HIM+',
      adapterID: 'python',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    // The DAP launch response is only sent after configurationDone, so do not
    // block on it before setting breakpoints.
    const launchResponse = client.request('launch', {
      name: 'HIM+ Python',
      type: 'python',
      request: 'launch',
      program: filePath,
      cwd,
      console: 'internalConsole',
      justMyCode: request.justMyCode !== false,
      stopOnEntry: false,
      env: {},
      args: [],
      pathMappings: [],
    });
    launchResponse.catch(() => undefined);
    // debugpy emits "initialized" once the target is ready for breakpoints.
    await client.waitForEvent('initialized', 8_000).catch(() => undefined);
    for (const breakpoint of request.breakpoints || []) {
      if (!Array.isArray(breakpoint.lines) || breakpoint.lines.length === 0) continue;
      const absolute = path.isAbsolute(breakpoint.path)
        ? breakpoint.path
        : path.resolve(request.workspace, breakpoint.path);
      await client
        .request('setBreakpoints', {
          source: { path: absolute, name: path.basename(absolute) },
          breakpoints: breakpoint.lines.map((line) => ({ line })),
          lines: breakpoint.lines,
        })
        .catch(() => undefined);
    }
    await client.request('configurationDone', {}).catch(() => undefined);
    await Promise.race([
      launchResponse,
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]).catch(() => undefined);
    return { ok: true };
  } catch (error) {
    await stopDebugSession();
    const message = (error as Error).message || 'Could not start the debugger.';
    return {
      ok: false,
      error: message.includes('debugpy')
        ? message
        : `${message} — install the adapter with "pip install debugpy".`,
    };
  }
}

export async function stopDebugSession(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  try {
    await current.client.request('disconnect', { terminateDebuggee: true }, 2_000);
  } catch {
    // ignore
  }
  current.client.dispose();
  killTree(current.child);
}

export async function debugRequest(input: DebugRequestInput): Promise<unknown> {
  const current = session;
  if (!current?.client.connected) throw new Error('No debug session is running.');
  if (!input || typeof input.command !== 'string' || !ALLOWED_COMMANDS.has(input.command)) {
    throw new Error('Unsupported debug command.');
  }
  return current.client.request(input.command, input.args || {});
}

export function debugStatus(): DebugSessionStatus {
  return {
    running: Boolean(session?.client.connected),
    adapter: session ? 'debugpy' : null,
  };
}

export function disposeDebugSession(): void {
  void stopDebugSession();
}

export function registerDebugIpc(): void {
  ipcMain.handle('debug:start', (event, request: DebugStartRequest) =>
    startDebugSession(request, event.sender),
  );
  ipcMain.handle('debug:stop', () => stopDebugSession());
  ipcMain.handle('debug:request', (_event, input: DebugRequestInput) => debugRequest(input));
  ipcMain.handle('debug:status', () => debugStatus());
}
