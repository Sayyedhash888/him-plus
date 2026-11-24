import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  GitCommitInput,
  GitCommitResult,
  GitDiffOptions,
  GitDiffResult,
  GitFileStatus,
  GitStatus,
  WorktreeResult,
} from '../shared/types';

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Keep git output deterministic and machine-readable.
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], {
    env: gitEnv(),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20_000,
  });
  return { stdout, stderr };
}

function letterFor(code: string): string {
  if (code.includes('?')) return 'U';
  if (code.includes('D')) return 'D';
  if (code.includes('A')) return 'A';
  if (code.includes('R')) return 'R';
  if (code.includes('C')) return 'C';
  if (code.includes('M')) return 'M';
  const trimmed = code.trim();
  return trimmed ? trimmed[0] : 'M';
}

export async function getGitStatus(root: string): Promise<GitStatus> {
  const resolved = path.resolve(root);
  try {
    const { stdout } = await git(resolved, ['status', '--porcelain=v1', '--branch']);
    const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
    let branch: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: GitFileStatus[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const header = line.slice(3);
        const noCommits = header.match(/No commits yet on (.+)$/);
        if (noCommits) {
          branch = noCommits[1].trim();
        } else {
          const branchPart = header.split(' [')[0];
          const name = branchPart.split('...')[0].replace(/^Initial commit on /, '').trim();
          branch = name === 'HEAD (no branch)' ? 'HEAD' : name || null;
        }
        const aheadMatch = header.match(/ahead (\d+)/);
        const behindMatch = header.match(/behind (\d+)/);
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
        behind = behindMatch ? Number(behindMatch[1]) : 0;
        continue;
      }
      if (line.length < 4) continue;
      const index = line[0];
      const worktree = line[1];
      let filePath = line.slice(3);
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop() || filePath;
      }
      if (
        (filePath.startsWith('"') && filePath.endsWith('"')) ||
        filePath.startsWith("'")
      ) {
        filePath = filePath.replace(/^["']|["']$/g, '');
      }
      files.push({ path: filePath, index, worktree, letter: letterFor(index + worktree) });
    }

    if (!branch) {
      try {
        const { stdout: branchOut } = await git(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']);
        branch = branchOut.trim() || null;
      } catch {
        branch = null;
      }
    }

    return { isRepo: true, root: resolved, branch, files, ahead, behind };
  } catch {
    return { isRepo: false, root: resolved, branch: null, files: [], ahead: 0, behind: 0 };
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'agent'
  );
}

export async function createWorktree(root: string, label: string): Promise<WorktreeResult> {
  const resolved = path.resolve(root);
  try {
    await git(resolved, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error('This workspace is not a git repository. Worktree isolation is unavailable.');
  }
  try {
    await git(resolved, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new Error(
      'This repository has no commits yet. Make an initial commit before using worktree isolation.',
    );
  }

  const repoBase = path.basename(resolved) || 'workspace';
  const slug = slugify(label);
  const suffix = Date.now().toString(36).slice(-4);
  const branch = `him/${slug}-${suffix}`;
  const worktreePath = path.join(
    app.getPath('userData'),
    'worktrees',
    `${repoBase}-${slug}-${suffix}`,
  );

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  try {
    await git(resolved, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  } catch (error) {
    const message = (error as { stderr?: string }).stderr || (error as Error).message;
    throw new Error(`Could not create worktree: ${message.trim()}`);
  }

  return { path: worktreePath, branch };
}

const MAX_GIT_OUTPUT = 60_000;

function clipGitOutput(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_GIT_OUTPUT) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_GIT_OUTPUT)}\n\n[... ${value.length - MAX_GIT_OUTPUT} characters omitted ...]`,
    truncated: true,
  };
}

function resolveInsideWorkspace(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path "${relative}" is outside the workspace.`);
  }
  return rel.replaceAll('\\', '/');
}

export async function getGitDiff(
  root: string,
  options: GitDiffOptions = {},
): Promise<GitDiffResult> {
  const resolved = path.resolve(root);
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (options?.staged) args.push('--staged');
  args.push('--');
  if (typeof options?.path === 'string' && options.path.trim()) {
    args.push(resolveInsideWorkspace(resolved, options.path.trim()));
  }
  try {
    const { stdout } = await git(resolved, args);
    const clipped = clipGitOutput(stdout.trimEnd());
    return { diff: clipped.text || '(no changes)', truncated: clipped.truncated };
  } catch (error) {
    throw new Error(
      `Could not read the git diff: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`,
    );
  }
}

export async function getGitLog(root: string, count?: number): Promise<string> {
  const resolved = path.resolve(root);
  const limit = Math.min(Math.max(Number(count) || 20, 1), 100);
  try {
    const { stdout } = await git(resolved, [
      'log',
      '--oneline',
      '--decorate',
      '-n',
      String(limit),
    ]);
    return clipGitOutput(stdout.trimEnd()).text || '(no commits yet)';
  } catch {
    return '(no commits yet, or this workspace is not a git repository)';
  }
}

export async function commitChanges(  root: string,
  input: GitCommitInput,
): Promise<GitCommitResult> {
  const resolved = path.resolve(root);
  const message = (input?.message || '').trim();
  if (!message) throw new Error('A commit message is required.');
  if (message.length > 4000) throw new Error('The commit message is too long.');

  if (input.stageAll) {
    await git(resolved, ['add', '-A']);
  } else if (Array.isArray(input.paths) && input.paths.length > 0) {
    const safePaths = input.paths
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => resolveInsideWorkspace(resolved, item.trim()));
    if (safePaths.length === 0) throw new Error('No valid paths were provided to stage.');
    await git(resolved, ['add', '--', ...safePaths]);
  } else {
    const status = await getGitStatus(resolved);
    if (!status.isRepo) throw new Error('This workspace is not a git repository.');
    if (status.files.length === 0) {
      return { committed: false, summary: 'Nothing to commit: the working tree is clean.' };
    }
    throw new Error('List the files to stage in "paths", or set "stage_all" to true.');
  }

  const staged = await git(resolved, ['diff', '--cached', '--name-only']);
  if (!staged.stdout.trim()) {
    return { committed: false, summary: 'Nothing staged, so no commit was created.' };
  }
  try {
    const { stdout } = await git(resolved, ['commit', '-m', message]);
    return { committed: true, summary: clipGitOutput(stdout.trim()).text || 'Committed.' };
  } catch (error) {
    throw new Error(
      `git commit failed: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`,
    );
  }
}

export async function stagePaths(root: string, paths: string[]): Promise<void> {
  const resolved = path.resolve(root);
  const safePaths = (Array.isArray(paths) ? paths : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => resolveInsideWorkspace(resolved, item.trim()));
  if (safePaths.length === 0) return;
  await git(resolved, ['add', '--', ...safePaths]);
}

export async function unstagePaths(root: string, paths: string[]): Promise<void> {
  const resolved = path.resolve(root);
  const safePaths = (Array.isArray(paths) ? paths : [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => resolveInsideWorkspace(resolved, item.trim()));
  if (safePaths.length === 0) return;
  try {
    await git(resolved, ['reset', 'HEAD', '--', ...safePaths]);
  } catch {
    // Repositories without commits cannot reset against HEAD; unstage via rm --cached.
    await git(resolved, ['rm', '--cached', '--', ...safePaths]);
  }
}

export async function discardPath(
  root: string,
  relPath: string,
  untracked = false,
): Promise<void> {
  const resolved = path.resolve(root);
  const safePath = resolveInsideWorkspace(resolved, relPath);
  const absolute = path.join(resolved, safePath);
  if (untracked) {
    const { shell } = await import('electron');
    await shell.trashItem(absolute);
    return;
  }
  await git(resolved, ['checkout', '--', safePath]);
}

/** Reads a file's committed content (HEAD by default) for diff review. */
export async function showFileAtRef(
  root: string,
  relPath: string,
  ref = 'HEAD',
): Promise<string> {
  const resolved = path.resolve(root);
  const safePath = resolveInsideWorkspace(resolved, relPath);
  const safeRef = /^[A-Za-z0-9._\/~^-]+$/.test(ref) ? ref : 'HEAD';
  try {
    const { stdout } = await git(resolved, ['show', `${safeRef}:${safePath}`]);
    return stdout;
  } catch {
    // New/untracked files have no committed version.
    return '';
  }
}

export function registerGitIpc(): void {
  ipcMain.handle('git:status', (_event, root: string) => getGitStatus(root));
  ipcMain.handle('git:worktree', (_event, root: string, label: string) =>
    createWorktree(root, label),
  );
  ipcMain.handle('git:diff', (_event, root: string, options?: GitDiffOptions) =>
    getGitDiff(root, options),
  );
  ipcMain.handle('git:log', (_event, root: string, count?: number) => getGitLog(root, count));
  ipcMain.handle('git:commit', (_event, root: string, input: GitCommitInput) =>
    commitChanges(root, input),
  );
  ipcMain.handle('git:stage', (_event, root: string, paths: string[]) =>
    stagePaths(root, paths),
  );
  ipcMain.handle('git:unstage', (_event, root: string, paths: string[]) =>
    unstagePaths(root, paths),
  );
  ipcMain.handle(
    'git:discard',
    (_event, root: string, relPath: string, untracked?: boolean) =>
      discardPath(root, relPath, untracked === true),
  );
  ipcMain.handle('git:showFile', (_event, root: string, relPath: string, ref?: string) =>
    showFileAtRef(root, relPath, ref),
  );
}
