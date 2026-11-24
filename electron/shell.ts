import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import type {
  ExecRequest,
  ExecResult,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalRunResult,
} from '../shared/types';

const MAX_CAPTURE = 300_000;

interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  sender: WebContents;
  child: ChildProcess | null;
  running: boolean;
}

const terminals = new Map<string, TerminalSession>();
const execChildren = new Map<string, ChildProcess>();
const killedRuns = new Set<string>();

function markKilled(runId: string): void {
  killedRuns.add(runId);
}

function wasKilled(runId: string): boolean {
  return killedRuns.has(runId);
}

function clearKilled(runId: string): void {
  killedRuns.delete(runId);
}

function killProcessTree(child: ChildProcess | null | undefined): void {
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

function shellLabel(): string {
  if (process.platform === 'win32') return 'cmd.exe';
  return path.basename(process.env.SHELL || '/bin/sh');
}

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: 'xterm-256color',
    HIM_TERMINAL: '1',
  };
}

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload);
}

interface RunOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  onSpawn?: (child: ChildProcess) => void;
}

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(options: RunOptions): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let captured = 0;
    let timedOut = false;
    let settled = false;
    let child: ChildProcess;

    try {
      child = spawn(options.command, {
        cwd: options.cwd,
        shell: true,
        windowsHide: true,
        env: { ...childEnv(), PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: 1, stdout: '', stderr: (error as Error).message, timedOut: false });
      return;
    }

    options.onSpawn?.(child);

    const emit = (chunk: string, stream: 'stdout' | 'stderr') => {
      if (!chunk) return;
      if (captured < MAX_CAPTURE) {
        const remaining = MAX_CAPTURE - captured;
        const slice = chunk.slice(0, remaining);
        captured += slice.length;
        if (stream === 'stdout') stdout += slice;
        else stderr += slice;
        options.onChunk?.(slice, stream);
        if (captured >= MAX_CAPTURE) {
          const marker = '\n[output truncated by HIM+]\n';
          if (stream === 'stdout') stdout += marker;
          else stderr += marker;
          options.onChunk?.(marker, stream);
        }
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => emit(data, 'stdout'));
    child.stderr?.on('data', (data: string) => emit(data, 'stderr'));

    const timer = setTimeout(
      () => {
        if (settled) return;
        timedOut = true;
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
          child.kill();
        }
      },
      Math.max(1_000, options.timeoutMs ?? 180_000),
    );

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      emit(`${error.message}\n`, 'stderr');
      resolve({ code: 1, stdout, stderr, timedOut: false });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        emit('\n[command timed out]\n', 'stderr');
      }
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function emitTerminal(session: TerminalSession, chunk: string, stream: TerminalDataEvent['stream']) {
  safeSend(session.sender, 'terminal:data', {
    id: session.id,
    chunk,
    stream,
  } satisfies TerminalDataEvent);
}

function resolveCdTarget(cwd: string, targetRaw: string): string {
  let target = targetRaw.trim().replace(/^["']|["']$/g, '');
  if (!target || target === '~') {
    target = process.env.USERPROFILE || process.env.HOME || cwd;
  }
  if (process.platform === 'win32' && /^[a-zA-Z]:$/.test(target)) target = `${target}\\`;
  return path.resolve(cwd, target);
}

async function createTerminal(sender: WebContents, cwd: string): Promise<TerminalCreateResult> {
  let base = path.resolve(cwd || process.env.USERPROFILE || process.cwd());
  try {
    if (!fsSync.statSync(base).isDirectory()) throw new Error('not a directory');
  } catch {
    base = process.env.USERPROFILE || process.cwd();
  }
  const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const session: TerminalSession = {
    id,
    cwd: base,
    shell: shellLabel(),
    sender,
    child: null,
    running: false,
  };
  terminals.set(id, session);
  return { id, cwd: base, shell: session.shell };
}

async function runInTerminal(id: string, command: string): Promise<TerminalRunResult> {
  const session = terminals.get(id);
  if (!session) throw new Error('Terminal session not found.');
  if (session.running) throw new Error('A command is already running in this terminal.');
  const trimmed = command.trim();
  if (!trimmed) return { code: 0, cwd: session.cwd, output: '' };

  const cdMatch = /^(?:cd|chdir|set-location)\s+(.+)$/i.exec(trimmed);
  const isSimpleCd = cdMatch && !/[&|;]/.test(trimmed);
  if (isSimpleCd) {
    const target = resolveCdTarget(session.cwd, cdMatch[1]);
    try {
      if (!fsSync.statSync(target).isDirectory()) throw new Error('not a directory');
      session.cwd = target;
      emitTerminal(session, '', 'system');
      return { code: 0, cwd: session.cwd, output: '' };
    } catch {
      return {
        code: 1,
        cwd: session.cwd,
        output: `cd: no such directory: ${target}`,
      };
    }
  }

  session.running = true;
  try {
    const outcome = await runProcess({
      command: trimmed,
      cwd: session.cwd,
      onChunk: (chunk, stream) => emitTerminal(session, chunk, stream),
      onSpawn: (child) => {
        session.child = child;
      },
    });
    session.child = null;
    const output = `${outcome.stdout}${outcome.stderr}`;
    return { code: outcome.code, cwd: session.cwd, output };
  } finally {
    session.running = false;
    session.child = null;
  }
}

export function registerShellIpc(): void {
  ipcMain.handle('exec:run', async (event, request: ExecRequest): Promise<ExecResult> => {
    if (!request || typeof request.command !== 'string' || typeof request.cwd !== 'string') {
      throw new Error('Invalid command request.');
    }
    const resolvedCwd = path.resolve(request.cwd);
    const outcome = await runProcess({
      command: request.command,
      cwd: resolvedCwd,
      timeoutMs: request.timeoutMs,
      onSpawn: (child) => {
        execChildren.set(request.runId, child);
        child.once('exit', () => {
          if (execChildren.get(request.runId) === child) execChildren.delete(request.runId);
        });
      },
      onChunk: (chunk, stream) => {
        safeSend(event.sender, 'exec:chunk', {
          runId: request.runId,
          chunk,
          stream,
        });
      },
    });
    const killed = wasKilled(request.runId);
    clearKilled(request.runId);
    execChildren.delete(request.runId);
    return {
      code: outcome.code,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      cwd: resolvedCwd,
      timedOut: outcome.timedOut,
      killed,
    };
  });

  ipcMain.handle('exec:kill', (_event, runId: string) => {
    if (typeof runId !== 'string' || !runId.trim()) return;
    const child = execChildren.get(runId);
    if (!child) return;
    markKilled(runId);
    killProcessTree(child);
  });

  ipcMain.handle('terminal:create', (event, cwd: string) => createTerminal(event.sender, cwd));
  ipcMain.on('terminal:input', (_event, id: string, data: string) => {
    if (typeof id !== 'string' || typeof data !== 'string') return;
    const session = terminals.get(id);
    if (!session?.child?.stdin || session.child.stdin.destroyed) return;
    const payload = data.slice(0, 64_000);
    if (!payload) return;
    try {
      session.child.stdin.write(payload);
    } catch {
      // The process may have exited between the keystroke and this write.
    }
  });
  ipcMain.handle('terminal:run', (_event, request) => {
    if (!request || typeof request.id !== 'string' || typeof request.command !== 'string') {
      throw new Error('Invalid terminal request.');
    }
    return runInTerminal(request.id, request.command);
  });
  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = terminals.get(id);
    if (!session?.child) return;
    try {
      if (process.platform === 'win32' && session.child.pid) {
        spawn('taskkill', ['/pid', String(session.child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        session.child.kill('SIGTERM');
      }
    } catch {
      session.child.kill();
    }
  });
  ipcMain.handle('terminal:dispose', (_event, id: string) => {
    const session = terminals.get(id);
    if (!session) return;
    try {
      session.child?.kill();
    } catch {
      // ignore
    }
    terminals.delete(id);
  });
}
