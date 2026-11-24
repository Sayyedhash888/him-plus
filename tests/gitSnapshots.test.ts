import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createSnapshot,
  diffSnapshot,
  listSnapshots,
  revertSnapshot,
} from '../electron/gitSnapshots.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true });
}

async function makeRepo(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'him-checkpoint-'));
  await git(root, 'init');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'HIM Test');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n', 'utf8');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-m', 'init');
  return root;
}

test('creates a snapshot, diffs changes and reverts them', async () => {
  const root = await makeRepo();
  try {
    const checkpoint = await createSnapshot('session-1', root, 'Before agent run');
    assert.ok(checkpoint.ref.startsWith('refs/him/checkpoints/session-1/'));
    assert.equal(checkpoint.fileCount, 1);

    fs.writeFileSync(path.join(root, 'a.txt'), 'two\n', 'utf8');
    fs.writeFileSync(path.join(root, 'b.txt'), 'new file\n', 'utf8');

    const changes = await diffSnapshot(root, checkpoint.ref);
    assert.deepEqual(
      changes.map((file) => `${file.path}:${file.status}`),
      ['a.txt:modified', 'b.txt:added'],
    );
    assert.equal(changes[0].before, 'one\n');
    assert.equal(changes[0].after, 'two\n');
    assert.equal(changes[1].before, null);

    const result = await revertSnapshot(root, checkpoint.ref);
    assert.equal(result.restored, 1);
    assert.equal(result.deleted, 1);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(fs.existsSync(path.join(root, 'b.txt')), false);

    const listed = await listSnapshots('session-1', root);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].label, 'Before agent run');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses snapshots outside a git repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'him-no-git-'));
  try {
    await assert.rejects(() => createSnapshot('session-x', dir), /git repository/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
