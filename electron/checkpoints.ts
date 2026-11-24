import { ipcMain } from 'electron';
import type { CheckpointDiffFile, CheckpointInfo } from '../shared/types';
import {
  checkpointRef,
  createSnapshot,
  diffSnapshot,
  listSnapshots,
  revertSnapshot,
} from './gitSnapshots';

/**
 * Checkpoint operations, split from their Electron IPC registrar so the same
 * functions can be driven either by `ipcMain` (desktop) or by the agent daemon
 * over JSON-RPC. Everything here is plain Node: it delegates to gitSnapshots,
 * which shells out to `git` and nothing else.
 *
 * `checkpointRef` is imported rather than re-implemented — the previous local
 * copy could drift from `createSnapshot`'s layout, which would make
 * `checkpoint:diff`/`checkpoint:revert` address refs that never existed.
 */

function requireRoot(root: string): string {
  if (!root || typeof root !== 'string') throw new Error('A workspace root is required.');
  return root;
}

export function createCheckpoint(
  sessionId: string,
  root: string,
  label?: string,
): Promise<CheckpointInfo> {
  return createSnapshot(sessionId, requireRoot(root), label || 'Checkpoint');
}

export function listCheckpoints(sessionId: string, root: string): Promise<CheckpointInfo[]> {
  return listSnapshots(sessionId, requireRoot(root));
}

export function diffCheckpoint(
  sessionId: string,
  root: string,
  id: string,
): Promise<CheckpointDiffFile[]> {
  return diffSnapshot(requireRoot(root), checkpointRef(sessionId, id));
}

export function revertCheckpoint(
  sessionId: string,
  root: string,
  id: string,
): Promise<{ restored: number; deleted: number }> {
  return revertSnapshot(requireRoot(root), checkpointRef(sessionId, id));
}

export function registerCheckpointIpc(): void {
  ipcMain.handle(
    'checkpoint:create',
    (_event, sessionId: string, root: string, label?: string): Promise<CheckpointInfo> =>
      createCheckpoint(sessionId, root, label),
  );
  ipcMain.handle(
    'checkpoint:list',
    (_event, sessionId: string, root: string): Promise<CheckpointInfo[]> =>
      listCheckpoints(sessionId, root),
  );
  ipcMain.handle(
    'checkpoint:diff',
    (_event, sessionId: string, root: string, id: string): Promise<CheckpointDiffFile[]> =>
      diffCheckpoint(sessionId, root, id),
  );
  ipcMain.handle(
    'checkpoint:revert',
    (_event, sessionId: string, root: string, id: string) =>
      revertCheckpoint(sessionId, root, id),
  );
}
