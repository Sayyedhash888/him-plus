import { ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { FileNode, ReadFileResult, SearchResult, SearchMatch } from '../shared/types';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
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
  '.turbo',
]);

const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

/**
 * Optional workspace containment for the renderer's file IPC. When enabled,
 * every path is resolved and rejected unless it lives inside the open workspace.
 * The agent's own file tools already enforce this; this closes the IPC path so a
 * compromised renderer (or a future feature) cannot touch files outside the
 * project when the user keeps the default restriction on.
 */
let workspaceRoot: string | null = null;
let restrictToWorkspace = true;

export function configureWorkspaceAccess(root: string | null, restrict: boolean): void {
  workspaceRoot = root && root.trim() ? path.resolve(root) : null;
  restrictToWorkspace = restrict;
}

function guardPath(target: string): string {
  const resolved = path.resolve(target);
  if (!restrictToWorkspace || !workspaceRoot) return resolved;
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `Access outside the workspace is blocked: ${resolved}. Open that folder as the workspace, or disable "Restrict file access" in Settings.`,
    );
  }
  return resolved;
}

function isProbablyBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, 8192);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function friendlyFsError(error: unknown, action: string, target: string): Error {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return new Error(`${action} failed: "${target}" does not exist.`);
  if (code === 'EACCES' || code === 'EPERM')
    return new Error(`${action} failed: permission denied for "${target}".`);
  if (code === 'EEXIST') return new Error(`${action} failed: "${target}" already exists.`);
  if (code === 'ENOTDIR') return new Error(`${action} failed: path component is not a directory.`);
  if (code === 'EISDIR') return new Error(`${action} failed: "${target}" is a directory.`);
  return new Error(`${action} failed: ${(error as Error)?.message || 'unknown error'}`);
}

export async function readDirectory(dirPath: string): Promise<FileNode[]> {
  const resolved = guardPath(assertString(dirPath, 'Path'));
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== '.git' && entry.name !== '.DS_Store')
      .map((entry) => {
        const full = path.join(resolved, entry.name);
        return {
          name: entry.name,
          path: full,
          isDirectory: entry.isDirectory(),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  } catch (error) {
    throw friendlyFsError(error, 'Read directory', resolved);
  }
}

export async function readTextFile(filePath: string): Promise<ReadFileResult> {
  const resolved = guardPath(assertString(filePath, 'Path'));
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error(`"${resolved}" is not a file.`);
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${(stat.size / 1024 / 1024).toFixed(1)} MB - the preview limit is 4 MB.`,
      );
    }
    const buffer = await fs.readFile(resolved);
    const binary = isProbablyBinary(buffer);
    return {
      path: resolved,
      content: binary ? '' : buffer.toString('utf8'),
      size: stat.size,
      binary,
    };
  } catch (error) {
    throw friendlyFsError(error, 'Read file', resolved);
  }
}

/** Reads a raster image from disk as a data URL for the in-app image viewer. */
export async function readImageFile(filePath: string): Promise<string> {
  const resolved = guardPath(assertString(filePath, 'Path'));
  const ext = path.extname(resolved).slice(1).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) throw new Error(`"${resolved}" is not a supported image file.`);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error(`"${resolved}" is not a file.`);
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is ${(stat.size / 1024 / 1024).toFixed(1)} MB - the preview limit is 25 MB.`,
      );
    }
    const bytes = await fs.readFile(resolved);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (error) {
    throw friendlyFsError(error, 'Read image', resolved);
  }
}

export async function writeTextFile(filePath: string, content: unknown): Promise<void> {
  const resolved = guardPath(assertString(filePath, 'Path'));
  if (typeof content !== 'string') throw new Error('File content must be a string.');
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf8');
  } catch (error) {
    throw friendlyFsError(error, 'Write file', resolved);
  }
}

async function createEntry(target: string, kind: 'file' | 'directory'): Promise<void> {
  const resolved = guardPath(assertString(target, 'Path'));
  try {
    if (kind === 'directory') {
      await fs.mkdir(resolved, { recursive: false });
    } else {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, '', { flag: 'wx' });
    }
  } catch (error) {
    throw friendlyFsError(error, kind === 'directory' ? 'Create folder' : 'Create file', resolved);
  }
}

async function listWorkspaceFiles(root: string, limit = 4000): Promise<string[]> {
  const resolvedRoot = guardPath(assertString(root, 'Workspace'));
  const results: string[] = [];
  const stack: string[] = [resolvedRoot];
  try {
    while (stack.length > 0 && results.length < limit) {
      const current = stack.pop()!;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (results.length >= limit) break;
        if (entry.name === '.DS_Store') continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          stack.push(full);
        } else if (entry.isFile()) {
          results.push(path.relative(resolvedRoot, full).replaceAll('\\', '/'));
        }
      }
    }
    results.sort((a, b) => a.localeCompare(b));
    return results;
  } catch (error) {
    throw friendlyFsError(error, 'List workspace', resolvedRoot);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchWorkspace(
  root: string,
  options: { query: string; regex?: boolean; caseSensitive?: boolean; maxResults?: number },
): Promise<SearchResult> {
  const started = Date.now();
  const resolvedRoot = guardPath(assertString(root, 'Workspace'));
  const query = assertString(options?.query, 'Search query');
  const maxResults = Math.max(1, Math.min(options.maxResults ?? 200, 500));
  let matcher: RegExp;
  try {
    matcher = new RegExp(
      options.regex ? query : escapeRegExp(query),
      options.caseSensitive ? 'g' : 'gi',
    );
  } catch (error) {
    throw new Error(`Invalid regular expression: ${(error as Error).message}`);
  }

  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;
  const stack: string[] = [resolvedRoot];

  while (stack.length > 0 && !truncated) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (truncated) break;
      if (entry.name === '.DS_Store') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(full);
      } catch {
        continue;
      }
      if (isProbablyBinary(buffer)) continue;
      filesScanned += 1;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        matcher.lastIndex = 0;
        const match = matcher.exec(lines[i]);
        if (!match) continue;
        matches.push({
          path: full,
          line: i + 1,
          column: (match.index ?? 0) + 1,
          preview: lines[i].slice(0, 320),
        });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }
  }

  return { matches, truncated, filesScanned, elapsedMs: Date.now() - started };
}

export function registerFsIpc(): void {
  ipcMain.handle('fs:readDir', (_event, dirPath: string) => readDirectory(dirPath));
  ipcMain.handle('fs:readFile', (_event, filePath: string) => readTextFile(filePath));
  ipcMain.handle('fs:readImage', (_event, filePath: string) => readImageFile(filePath));
  ipcMain.handle('fs:writeFile', (_event, filePath: string, content: string) =>
    writeTextFile(filePath, content),
  );
  ipcMain.handle('fs:create', (_event, target: string, kind: 'file' | 'directory') =>
    createEntry(target, kind),
  );
  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    const from = guardPath(assertString(oldPath, 'Path'));
    const to = guardPath(assertString(newPath, 'Path'));
    try {
      if (await pathExists(to)) throw new Error(`"${to}" already exists.`);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    } catch (error) {
      throw error instanceof Error && error.message.includes('already exists')
        ? error
        : friendlyFsError(error, 'Rename', from);
    }
  });
  ipcMain.handle('fs:trash', async (_event, target: string) => {
    const resolved = guardPath(assertString(target, 'Path'));
    try {
      await shell.trashItem(resolved);
    } catch (error) {
      throw friendlyFsError(error, 'Move to trash', resolved);
    }
  });
  ipcMain.handle('fs:exists', async (_event, target: string) => {
    if (typeof target !== 'string' || !target.trim()) return false;
    let resolved: string;
    try {
      resolved = guardPath(target);
    } catch {
      return false;
    }
    if (fsSync.existsSync(resolved)) return true;
    try {
      await fs.stat(resolved);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(
    'fs:setWorkspaceAccess',
    (_event, root: string | null, restrict: boolean) => {
      configureWorkspaceAccess(root, restrict !== false);
    },
  );
  ipcMain.handle('fs:listFiles', (_event, root: string, limit?: number) =>
    listWorkspaceFiles(root, limit),
  );
  ipcMain.handle(
    'search:run',
    (
      _event,
      root: string,
      options: { query: string; regex?: boolean; caseSensitive?: boolean; maxResults?: number },
    ) => searchWorkspace(root, options),
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

