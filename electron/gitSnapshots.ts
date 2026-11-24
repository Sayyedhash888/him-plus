import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CheckpointDiffFile, CheckpointInfo } from '../shared/types';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout;
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const output = await git(root, ['rev-parse', '--is-inside-work-tree']);
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Checkpoint refs are `refs/him/checkpoints/<safeSession>[/<safeId>]`.
 *
 * Exported because `checkpoints.ts` used to re-implement this layout, which meant
 * a change here could silently desync `checkpoint:diff`/`checkpoint:revert` from
 * what `createSnapshot` actually wrote. Keep this the only definition.
 */
export function refPrefix(sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'session';
  return `refs/him/checkpoints/${safeSession}`;
}

export function checkpointRef(sessionId: string, id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${refPrefix(sessionId)}/${safeId}`;
}

async function currentTree(root: string): Promise<string> {
  const indexPath = path.join(os.tmpdir(), `him-checkpoint-index-${crypto.randomUUID()}`);
  try {
    await git(root, ['add', '-A'], { GIT_INDEX_FILE: indexPath });
    return (await git(root, ['write-tree'], { GIT_INDEX_FILE: indexPath })).trim();
  } finally {
    await fs.rm(indexPath, { force: true }).catch(() => undefined);
    await fs.rm(`${indexPath}.lock`, { force: true }).catch(() => undefined);
  }
}

async function fileCountAt(root: string, ref: string): Promise<number> {
  try {
    const output = await git(root, ['ls-tree', '-r', '--name-only', ref]);
    return output.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Creates a full workspace snapshot (tracked + untracked, respecting .gitignore)
 * without touching the working tree or the real index. The snapshot is stored as
 * a git commit referenced under refs/him/checkpoints so it survives restarts.
 */
export async function createSnapshot(
  sessionId: string,
  root: string,
  label = 'Checkpoint',
): Promise<CheckpointInfo> {
  if (!(await isGitRepo(root))) {
    throw new Error('Checkpoints require a git repository (or an isolated agent worktree).');
  }
  const tree = await currentTree(root);
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const commit = (
    await git(root, ['commit-tree', tree, '-m', `HIM checkpoint: ${label}`])
  ).trim();
  const ref = checkpointRef(sessionId, id);
  await git(root, ['update-ref', ref, commit]);
  return {
    id,
    sessionId,
    label,
    createdAt: Date.now(),
    ref,
    fileCount: await fileCountAt(root, ref),
  };
}

export async function listSnapshots(sessionId: string, root: string): Promise<CheckpointInfo[]> {
  if (!(await isGitRepo(root))) return [];
  const prefix = refPrefix(sessionId);
  let output = '';
  try {
    output = await git(root, [
      'for-each-ref',
      '--format=%(refname)%09%(creatordate:unix)%09%(subject)',
      prefix,
    ]);
  } catch {
    return [];
  }
  const items: CheckpointInfo[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [ref, createdRaw, subject] = line.split('\t');
    const created = Number(createdRaw) * 1000;
    items.push({
      id: ref.slice(ref.lastIndexOf('/') + 1),
      sessionId,
      label: (subject || 'Checkpoint').replace(/^HIM checkpoint:\s*/, ''),
      createdAt: Number.isFinite(created) ? created : Date.now(),
      ref,
      fileCount: await fileCountAt(root, ref),
    });
  }
  return items.sort((left, right) => right.createdAt - left.createdAt);
}

async function readAtRef(root: string, ref: string, relPath: string): Promise<string | null> {
  try {
    return await git(root, ['show', `${ref}:${relPath}`]);
  } catch {
    return null;
  }
}

function isProbablyBinary(text: string): boolean {
  return text.includes('\u0000');
}

/** Changed files between a snapshot ref and the current working tree. */
export async function diffSnapshot(
  root: string,
  ref: string,
  maxFiles = 200,
): Promise<CheckpointDiffFile[]> {
  const changed = new Map<string, 'added' | 'modified' | 'deleted'>();
  const tracked = await git(root, ['diff', '--name-status', ref]).catch(() => '');
  for (const line of tracked.split('\n')) {
    if (!line.trim()) continue;
    const [code, ...rest] = line.split('\t');
    const relPath = rest[rest.length - 1];
    if (!relPath) continue;
    if (code.startsWith('A')) changed.set(relPath, 'added');
    else if (code.startsWith('D')) changed.set(relPath, 'deleted');
    else changed.set(relPath, 'modified');
  }
  const untracked = await git(root, ['ls-files', '--others', '--exclude-standard']).catch(() => '');
  for (const relPath of untracked.split('\n')) {
    if (relPath.trim()) changed.set(relPath.trim(), 'added');
  }
  const files: CheckpointDiffFile[] = [];
  for (const [relPath, status] of changed) {
    if (files.length >= maxFiles) break;
    if (relPath.includes('\u0000')) continue;
    const before = status === 'added' ? null : await readAtRef(root, ref, relPath);
    const absolute = path.join(root, relPath);
    let after: string | null = null;
    if (status !== 'deleted') {
      try {
        after = await fs.readFile(absolute, 'utf8');
      } catch {
        after = null;
      }
    }
    if ((before && isProbablyBinary(before)) || (after && isProbablyBinary(after))) continue;
    files.push({ path: relPath, status, before, after });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** Restores the working tree to a snapshot (deletes files added afterwards). */
export async function revertSnapshot(
  root: string,
  ref: string,
): Promise<{ restored: number; deleted: number }> {
  const files = await diffSnapshot(root, ref, 2000);
  let restored = 0;
  let deleted = 0;
  for (const file of files) {
    const absolute = path.join(root, file.path);
    if (file.before === null) {
      await fs.rm(absolute, { force: true }).catch(() => undefined);
      deleted += 1;
      continue;
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, file.before, 'utf8');
    restored += 1;
  }
  return { restored, deleted };
}
