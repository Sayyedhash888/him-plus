import type { GitFileStatus, GitStatus } from '@shared/types';

export interface GitGroups {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

/**
 * Splits `git status --porcelain` entries into the three sections a source
 * control panel needs (a file can appear in both staged and unstaged when it
 * was partially staged).
 */
export function groupGitFiles(status: GitStatus | null | undefined): GitGroups {
  const groups: GitGroups = { staged: [], unstaged: [], untracked: [] };
  for (const file of status?.files || []) {
    if (file.index === '?' || file.worktree === '?') {
      groups.untracked.push(file);
      continue;
    }
    if (file.index && file.index.trim().length > 0) groups.staged.push(file);
    if (file.worktree && file.worktree.trim().length > 0) groups.unstaged.push(file);
  }
  return groups;
}

export function commitDisabledReason(message: string, stagedCount: number): string | null {
  if (!message.trim()) return 'Write a commit message first.';
  if (stagedCount === 0) return 'Stage at least one change first.';
  return null;
}

export function statusLabel(file: GitFileStatus): string {
  const code = file.letter || 'M';
  if (code === 'U' || code === '?') return 'untracked';
  if (code === 'A') return 'added';
  if (code === 'D') return 'deleted';
  if (code === 'R') return 'renamed';
  if (code === 'C') return 'copied';
  return 'modified';
}
