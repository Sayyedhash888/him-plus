import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { WatchChangedEvent } from '../shared/types';

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.idea',
  '.him-worktrees',
  '.npm-cache',
  '.electron-cache',
  '.yarn',
  '.pnpm-store',
]);

const DEBOUNCE_MS = 300;
const MAX_BATCH = 200;

let watcher: fs.FSWatcher | null = null;
let currentRoot: string | null = null;
let sender: WebContents | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const pending = new Set<string>();

function shouldIgnore(relative: string): boolean {
  const segments = relative.split(/[\\/]/);
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

function flush(): void {
  timer = null;
  if (!sender || sender.isDestroyed() || pending.size === 0) {
    pending.clear();
    return;
  }
  const paths = [...pending].slice(0, MAX_BATCH);
  pending.clear();
  const event: WatchChangedEvent = { root: currentRoot || '', paths };
  sender.send('watch:changed', event);
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(flush, DEBOUNCE_MS);
}

export function stopWatching(): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // already closed
    }
    watcher = null;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending.clear();
  currentRoot = null;
  sender = null;
}

export function startWatching(tab: WebContents, root: string): void {
  const resolved = path.resolve(root || '');
  if (!resolved) throw new Error('A workspace path is required to watch for changes.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Cannot watch ${resolved}: it is not a directory.`);
  }
  if (watcher && currentRoot === resolved) {
    sender = tab;
    return;
  }
  stopWatching();
  currentRoot = resolved;
  sender = tab;

  const onEvent = (_event: string, filename: string | Buffer | null) => {
    const relative = filename ? String(filename).replaceAll('\\', '/') : '';
    if (!relative || shouldIgnore(relative)) return;
    pending.add(relative);
    if (pending.size > MAX_BATCH) pending.delete(pending.values().next().value as string);
    schedule();
  };

  try {
    watcher = fs.watch(resolved, { recursive: true, persistent: false }, onEvent);
  } catch {
    try {
      // Some filesystems (and non-Windows platforms) reject recursive watches.
      watcher = fs.watch(resolved, { persistent: false }, onEvent);
    } catch (error) {
      stopWatching();
      throw new Error(
        `Could not watch the workspace for changes: ${(error as Error).message || 'unknown error'}`,
      );
    }
  }
  watcher.on('error', () => {
    stopWatching();
  });
}

export function registerWatchIpc(): void {
  ipcMain.handle('watch:start', (event, root: string) => {
    startWatching(event.sender, root);
  });
  ipcMain.handle('watch:stop', () => {
    stopWatching();
  });
}
