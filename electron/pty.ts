import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { PtyCreateResult, PtyDataEvent } from '../shared/types';

/**
 * Real PTY terminals backed by @homebridge/node-pty-prebuilt-multiarch.
 *
 * The package is loaded through require() (native .node binaries are shipped in
 * its prebuilds/ folder and copied into resources/app/node_modules at package
 * time), so Electron main must keep the import external to esbuild.
 */

interface PtySession {
  id: string;
  pty: PtyLike;
  cwd: string;
  shell: string;
  sender: WebContents;
}

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

const require = createRequire(__filename);
let ptyModule: PtyModule | null = null;
let ptyLoadError: string | null = null;
const sessions = new Map<string, PtySession>();

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
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(probe, [command], { windowsHide: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

interface ShellSpec {
  command: string;
  args: string[];
  label: string;
}

export function resolveShell(): ShellSpec {
  if (process.platform === 'win32') {
    if (commandExists('pwsh')) return { command: 'pwsh.exe', args: ['-NoLogo'], label: 'pwsh' };
    if (commandExists('powershell')) {
      return { command: 'powershell.exe', args: ['-NoLogo'], label: 'powershell' };
    }
    const comspec = process.env.ComSpec || 'cmd.exe';
    return {
      command: comspec,
      args: [],
      label: path.basename(comspec).replace(/\.exe$/i, ''),
    };
  }
  const shell = process.env.SHELL || '/bin/bash';
  return { command: shell, args: [], label: path.basename(shell) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function sendData(session: PtySession, chunk: string): void {
  if (session.sender.isDestroyed()) return;
  session.sender.send('pty:data', { id: session.id, chunk } satisfies PtyDataEvent);
}

export function createPty(
  sender: WebContents,
  cwd: string,
  cols = 120,
  rows = 30,
): PtyCreateResult {
  const pty = loadPty();
  const resolved = path.resolve(cwd || process.env.USERPROFILE || process.cwd());
  const shell = resolveShell();
  const id = `pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const child = pty.spawn(shell.command, shell.args, {
    name: 'xterm-256color',
    cols: clamp(cols, 20, 400),
    rows: clamp(rows, 5, 200),
    cwd: resolved,
    env: {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      HIM_TERMINAL: '1',
    },
    useConpty: process.platform === 'win32',
  });
  const session: PtySession = { id, pty: child, cwd: resolved, shell: shell.label, sender };
  sessions.set(id, session);
  child.onData((chunk) => sendData(session, chunk));
  child.onExit(({ exitCode }) => {
    sendData(session, `\r\n\x1b[38;2;120;130;150m[process exited with code ${exitCode}]\x1b[0m\r\n`);
    sessions.delete(id);
  });
  sender.once('destroyed', () => disposePty(id));
  return { id, cwd: resolved, shell: shell.label };
}

export function writePty(id: string, data: string): void {
  if (typeof data !== 'string' || !data) return;
  sessions.get(id)?.pty.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.pty.resize(clamp(cols, 20, 400), clamp(rows, 5, 200));
  } catch {
    // The process may have exited between a resize event and this call.
  }
}

export function killPty(id: string): void {
  try {
    sessions.get(id)?.pty.kill();
  } catch {
    // already gone
  }
}

export function disposePty(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  try {
    session.pty.kill();
  } catch {
    // already gone
  }
}

export function disposeAllPtys(): void {
  for (const id of [...sessions.keys()]) disposePty(id);
}

export function registerPtyIpc(): void {
  ipcMain.handle('pty:create', (event, cwd: string, cols?: number, rows?: number) => {
    try {
      return createPty(event.sender, cwd, cols, rows);
    } catch (error) {
      throw new Error((error as Error).message || 'Could not start a PTY terminal.');
    }
  });
  ipcMain.handle('pty:input', (_event, id: string, data: string) => writePty(id, data));
  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) =>
    resizePty(id, cols, rows),
  );
  ipcMain.handle('pty:kill', (_event, id: string) => killPty(id));
  ipcMain.handle('pty:dispose', (_event, id: string) => disposePty(id));
}
