import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type {
  CliAgentStartRequest,
  CliAgentStartResult,
} from '../shared/types';

/**
 * CLI agents ("terminal bridge"): a real PTY runs an interactive agent CLI
 * (Freebuff, Aider, Claude Code, …) and HIM+ relays its output into the chat
 * pane. This is deliberately *not* ACP: the CLI keeps its own permissions,
 * approval prompts and login flow, so the raw terminal is always available.
 */

interface PtyLike {
  onData(listener: (chunk: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
      useConpty?: boolean;
    },
  ): PtyLike;
}

interface CliSession {
  pty: PtyLike;
  sender: WebContents;
}

const require = createRequire(__filename);
let ptyModule: PtyModule | null = null;
let ptyLoadError: string | null = null;
const sessions = new Map<string, CliSession>();

function loadPty(): PtyModule {
  if (ptyModule) return ptyModule;
  if (ptyLoadError) throw new Error(ptyLoadError);
  try {
    ptyModule = require('@homebridge/node-pty-prebuilt-multiarch') as PtyModule;
    return ptyModule;
  } catch (error) {
    ptyLoadError = `PTY support is unavailable: ${(error as Error).message}`;
    throw new Error(ptyLoadError);
  }
}

function commandExists(command: string): boolean {
  if (/[\\/]/.test(command)) {
    return fs.existsSync(command);
  }
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(probe, [command], { windowsHide: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function quoteWindowsArg(arg: string): string {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replaceAll('"', '\\"')}"`;
}

/**
 * npm-installed CLIs are .cmd shims on Windows, which node-pty cannot execute
 * directly, so resolve them through cmd.exe while keeping the same PTY.
 */
function spawnSpec(command: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const line = [command, ...args].map(quoteWindowsArg).join(' ');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line] };
  }
  return { file: command, args };
}

export async function startCliAgent(
  request: CliAgentStartRequest,
  sender: WebContents,
): Promise<CliAgentStartResult> {
  if (!request?.sessionId || typeof request.command !== 'string' || !request.command.trim()) {
    return { ok: false, error: 'No CLI command configured for this agent.' };
  }
  if (!request.cwd || !path.isAbsolute(request.cwd)) {
    return { ok: false, error: 'CLI agents require an absolute workspace path.' };
  }
  await stopCliAgent(request.sessionId);
  if (!commandExists(request.command.trim())) {
    return {
      ok: false,
      error: `Command "${request.command}" was not found on PATH. Install the CLI (for Freebuff: npm i -g freebuff) or edit the profile in Settings → Integrations → CLI agents.`,
    };
  }
  try {
    const spec = spawnSpec(request.command.trim(), request.args || []);
    const pty = loadPty().spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: request.cwd,
      env: {
        ...(process.env as Record<string, string>),
        ...(request.env || {}),
        TERM: 'xterm-256color',
      },
      useConpty: true,
    });
    const session: CliSession = { pty, sender };
    sessions.set(request.sessionId, session);
    pty.onData((data) => {
      if (!sender.isDestroyed()) sender.send('cliagent:data', { sessionId: request.sessionId, data });
    });
    pty.onExit((event) => {
      sessions.delete(request.sessionId);
      if (!sender.isDestroyed()) {
        sender.send('cliagent:exit', {
          sessionId: request.sessionId,
          exitCode: event.exitCode ?? null,
        });
      }
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not start "${request.command}": ${(error as Error).message}` };
  }
}

export function writeCliAgent(sessionId: string, data: string): void {
  sessions.get(sessionId)?.pty.write(data);
}

export function resizeCliAgent(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    session.pty.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)));
  } catch {
    // process already gone
  }
}

export async function stopCliAgent(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.pty.kill();
  } catch {
    // already exited
  }
}

export function disposeCliAgents(): void {
  for (const sessionId of [...sessions.keys()]) {
    void stopCliAgent(sessionId);
  }
}

export function registerCliAgentIpc(): void {
  ipcMain.handle('cliagent:start', (event, request: CliAgentStartRequest) =>
    startCliAgent(request, event.sender),
  );
  ipcMain.handle('cliagent:input', (_event, sessionId: string, data: string) => {
    writeCliAgent(sessionId, data);
  });
  ipcMain.handle(
    'cliagent:resize',
    (_event, sessionId: string, cols: number, rows: number) => {
      resizeCliAgent(sessionId, cols, rows);
    },
  );
  ipcMain.handle('cliagent:stop', (_event, sessionId: string) => stopCliAgent(sessionId));
}
