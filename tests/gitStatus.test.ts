import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitFileStatus, GitStatus } from '../shared/types.ts';
import { commitDisabledReason, groupGitFiles, statusLabel } from '../src/lib/gitStatus.ts';

function file(path: string, index: string, worktree: string): GitFileStatus {
  return { path, index, worktree, letter: index.trim() || worktree.trim() || 'M' };
}

const status: GitStatus = {
  isRepo: true,
  root: 'D:/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [
    file('staged.ts', 'M', ' '),
    file('unstaged.ts', ' ', 'M'),
    file('both.ts', 'M', 'M'),
    file('new-file.ts', '?', '?'),
    file('deleted.ts', ' ', 'D'),
    file('added.ts', 'A', ' '),
  ],
};

test('groups git status into staged, unstaged and untracked', () => {
  const groups = groupGitFiles(status);
  assert.deepEqual(
    groups.staged.map((item) => item.path),
    ['staged.ts', 'both.ts', 'added.ts'],
  );
  assert.deepEqual(
    groups.unstaged.map((item) => item.path),
    ['unstaged.ts', 'both.ts', 'deleted.ts'],
  );
  assert.deepEqual(
    groups.untracked.map((item) => item.path),
    ['new-file.ts'],
  );
});

test('handles empty or non-repository status', () => {
  const empty = groupGitFiles(null);
  assert.equal(empty.staged.length, 0);
  assert.equal(empty.unstaged.length, 0);
  assert.equal(empty.untracked.length, 0);
});

test('commit validation explains what is missing', () => {
  assert.equal(commitDisabledReason('', 2), 'Write a commit message first.');
  assert.equal(commitDisabledReason('fix: thing', 0), 'Stage at least one change first.');
  assert.equal(commitDisabledReason('fix: thing', 1), null);
});

test('status labels are human readable', () => {
  assert.equal(statusLabel(file('a', '?', '?')), 'untracked');
  assert.equal(statusLabel(file('b', 'A', ' ')), 'added');
  assert.equal(statusLabel(file('c', ' ', 'D')), 'deleted');
  assert.equal(statusLabel(file('d', ' ', 'M')), 'modified');
});
