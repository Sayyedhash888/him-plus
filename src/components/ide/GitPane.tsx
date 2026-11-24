import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  FolderOpen,
} from 'lucide-react';
import type { GitFileStatus } from '@shared/types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import {
  commitDisabledReason,
  groupGitFiles,
  statusLabel,
} from '../../lib/gitStatus';
import { openWorkspace } from '../../lib/actions';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { toast } from '../../store/toast';
import { cn } from '../../lib/utils';
import { Button, SectionLabel, Spinner } from '../ui';

function absolute(workspace: string, relative: string): string {
  return `${workspace.replace(/[\\/]+$/, '')}/${relative}`;
}

function FileRow({
  file,
  action,
  onOpen,
  onDiscard,
}: {
  file: GitFileStatus;
  action: { label: string; icon: typeof Plus; run(): void };
  onOpen(): void;
  onDiscard?(): void;
}) {
  const Icon = action.icon;
  const tone =
    file.letter === 'D'
      ? 'text-coral-soft'
      : file.letter === 'A' || file.letter === 'U' || file.letter === '?'
        ? 'text-mint/80'
        : 'text-sand';
  return (
    <div className="group flex h-6 items-center gap-1.5 rounded px-1.5 hover:bg-ink-800/70">
      <span className={cn('w-3 shrink-0 font-mono text-[8.5px] font-semibold', tone)}>
        {file.letter === '?' ? 'U' : file.letter}
      </span>
      <button
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left font-mono text-[9.5px] text-mist-dim hover:text-mist-bright"
        title={`${file.path} · ${statusLabel(file)}`}
      >
        {file.path}
      </button>
      {onDiscard && (
        <button
          onClick={onDiscard}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-mist-ghost opacity-0 hover:bg-ink-750 hover:text-coral-soft group-hover:opacity-100"
          title="Discard changes"
          aria-label={`Discard: ${file.path}`}
        >
          <RotateCcw size={9} />
        </button>
      )}
      <button
        onClick={action.run}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-mist-ghost opacity-0 hover:bg-ink-750 hover:text-mist group-hover:opacity-100"
        title={action.label}
        aria-label={`${action.label}: ${file.path}`}
      >
        <Icon size={9} />
      </button>
    </div>
  );
}

export function GitPane() {
  const workspace = useCoreStore((state) => state.workspace);
  const git = useCoreStore((state) => state.git);
  const openDiff = useEditorStore((state) => state.openDiff);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void useCoreStore.getState().refreshGit();
  }, [workspace, refreshKey]);

  const groups = groupGitFiles(git);
  const stagedCount = groups.staged.length;
  const disabledReason = commitDisabledReason(message, stagedCount);

  const refresh = () => {
    setRefreshKey((value) => value + 1);
    void useCoreStore.getState().refreshWorkspaceFiles();
  };

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      toast('success', successMessage, 'Git');
      refresh();
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Git');
    } finally {
      setBusy(false);
    }
  };

  const openFileDiff = async (file: GitFileStatus) => {
    if (!workspace) return;
    const untracked = file.index === '?' || file.worktree === '?';
    try {
      const original = untracked ? '' : await him.git.showFile(workspace, file.path);
      let modified = '';
      try {
        const result = await him.fs.readFile(absolute(workspace, file.path));
        modified = result.binary ? `[binary file: ${file.path}]` : result.content;
      } catch {
        modified = '';
      }
      openDiff(absolute(workspace, file.path), original, modified);
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Git diff');
    }
  };

  const stage = (paths: string[]) =>
    void runAction(() => him.git.stage(workspace!, paths), `Staged ${paths.length} file${paths.length === 1 ? '' : 's'}.`);
  const unstage = (paths: string[]) =>
    void runAction(() => him.git.unstage(workspace!, paths), `Unstaged ${paths.length} file${paths.length === 1 ? '' : 's'}.`);

  const discard = async (file: GitFileStatus) => {
    if (!workspace) return;
    const untracked = file.index === '?' || file.worktree === '?';
    const proceed = await him.dialog.confirm({
      title: untracked ? 'Delete untracked file?' : 'Discard changes?',
      message: untracked
        ? `Move ${file.path} to the recycle bin?`
        : `Discard uncommitted changes in ${file.path}?`,
      detail: 'This cannot be undone from HIM+.',
      confirmLabel: untracked ? 'Delete file' : 'Discard changes',
      danger: true,
    });
    if (!proceed) return;
    await runAction(
      () => him.git.discard(workspace, file.path, untracked),
      `${file.path} discarded.`,
    );
  };

  const commit = async () => {
    if (!workspace || disabledReason) return;
    setCommitBusy(true);
    try {
      const stagedPaths = groups.staged.map((file) => file.path);
      const result = await him.git.commit(workspace, {
        message,
        stageAll: false,
        paths: stagedPaths,
      });
      toast(
        result.committed ? 'success' : 'info',
        result.summary.split('\n')[0] || result.summary,
        'Commit',
      );
      if (result.committed) {
        setMessage('');
        refresh();
      }
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Commit failed');
    } finally {
      setCommitBusy(false);
    }
  };

  if (!workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <GitBranch size={18} className="text-mist-ghost" />
        <p className="text-[9.5px] leading-relaxed text-mist-faint">
          Open a workspace folder to use source control.
        </p>
        <Button size="xs" variant="outline" icon={<FolderOpen size={9} />} onClick={() => void openWorkspace()}>
          Open folder
        </Button>
      </div>
    );
  }

  if (git && !git.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <GitBranch size={18} className="text-mist-ghost" />
        <p className="text-[9.5px] leading-relaxed text-mist-faint">
          This folder is not a git repository.
        </p>
        <Button
          size="xs"
          variant="outline"
          icon={<GitCommitHorizontal size={9} />}
          onClick={() =>
            void runAction(
              () => him.exec.run({
                runId: `git-init-${Date.now()}`,
                command: 'git init',
                cwd: workspace,
              }).then(() => undefined),
              'Initialized repository.',
            )
          }
        >
          git init
        </Button>
      </div>
    );
  }

  const totalChanges = groups.staged.length + groups.unstaged.length + groups.untracked.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2.5">
        <SectionLabel>Source control</SectionLabel>
        <span className="ml-auto flex items-center gap-1 font-mono text-[8.5px] text-mist-ghost">
          <GitBranch size={9} />
          {git?.branch || 'detached'}
        </span>
        {(git?.ahead || 0) > 0 && (
          <span className="flex items-center gap-0.5 font-mono text-[8px] text-mint/80">
            <ArrowUp size={8} />
            {git?.ahead}
          </span>
        )}
        {(git?.behind || 0) > 0 && (
          <span className="flex items-center gap-0.5 font-mono text-[8px] text-sand">
            <ArrowDown size={8} />
            {git?.behind}
          </span>
        )}
        <button
          onClick={refresh}
          disabled={busy}
          className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist disabled:opacity-50"
          title="Refresh status"
          aria-label="Refresh git status"
        >
          {busy ? <Spinner size={9} /> : <RefreshCw size={9} />}
        </button>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-2 rounded-md border border-line bg-ink-850/40 p-1.5">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={stagedCount > 0 ? 'Commit message (Ctrl+Enter)' : 'Stage changes to commit…'}
            rows={2}
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void commit();
              }
            }}
            className="him-textarea block w-full resize-none border-0 bg-transparent px-1 text-[10px] leading-relaxed text-mist-bright outline-none placeholder:text-mist-ghost"
          />
          <div className="flex items-center gap-1 pt-1">
            <Button
              size="xs"
              variant="accent"
              icon={<GitCommitHorizontal size={9} />}
              disabled={Boolean(disabledReason) || commitBusy}
              loading={commitBusy}
              onClick={() => void commit()}
              title={disabledReason || 'Commit staged changes'}
            >
              Commit{stagedCount > 0 ? ` ${stagedCount}` : ''}
            </Button>
            {groups.unstaged.length + groups.untracked.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                icon={<Plus size={9} />}
                onClick={() =>
                  stage([
                    ...groups.unstaged.map((file) => file.path),
                    ...groups.untracked.map((file) => file.path),
                  ])
                }
              >
                Stage all
              </Button>
            )}
            <span className="ml-auto font-mono text-[8px] text-mist-ghost">
              {totalChanges} change{totalChanges === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {groups.staged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 px-1 pb-1">
              <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-mint/70">
                Staged
              </span>
              <span className="font-mono text-[8px] text-mist-ghost">{groups.staged.length}</span>
              <button
                onClick={() => unstage(groups.staged.map((file) => file.path))}
                className="ml-auto flex h-4 items-center gap-0.5 rounded px-1 text-[8px] text-mist-ghost hover:text-mist"
                title="Unstage all"
              >
                <Minus size={8} /> Unstage all
              </button>
            </div>
            {groups.staged.map((file) => (
              <FileRow
                key={`staged-${file.path}`}
                file={file}
                action={{
                  label: 'Unstage',
                  icon: Minus,
                  run: () => unstage([file.path]),
                }}
                onOpen={() => void openFileDiff(file)}
              />
            ))}
          </div>
        )}

        {groups.unstaged.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 px-1 pb-1">
              <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-sand/80">
                Changes
              </span>
              <span className="font-mono text-[8px] text-mist-ghost">{groups.unstaged.length}</span>
            </div>
            {groups.unstaged.map((file) => (
              <FileRow
                key={`unstaged-${file.path}`}
                file={file}
                action={{
                  label: 'Stage',
                  icon: Plus,
                  run: () => stage([file.path]),
                }}
                onDiscard={() => void discard(file)}
                onOpen={() => void openFileDiff(file)}
              />
            ))}
          </div>
        )}

        {groups.untracked.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 px-1 pb-1">
              <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
                Untracked
              </span>
              <span className="font-mono text-[8px] text-mist-ghost">{groups.untracked.length}</span>
            </div>
            {groups.untracked.map((file) => (
              <FileRow
                key={`untracked-${file.path}`}
                file={file}
                action={{ label: 'Stage', icon: Plus, run: () => stage([file.path]) }}
                onDiscard={() => void discard(file)}
                onOpen={() => void openFileDiff(file)}
              />
            ))}
          </div>
        )}

        {totalChanges === 0 && (
          <div className="mt-4 flex flex-col items-center gap-1.5 px-3 text-center">
            <Check size={14} className="text-mint/70" />
            <span className="text-[9.5px] text-mist-faint">Working tree clean</span>
            <span className="text-[8px] text-mist-ghost">
              Click a changed file to review its diff before committing.
            </span>
          </div>
        )}

        {totalChanges > 0 && (
          <div className="mt-1 flex items-center gap-1 px-1 text-[8px] text-mist-ghost">
            <RotateCcw size={8} /> Click a file to open a read-only diff tab.
          </div>
        )}
      </div>
    </div>
  );
}
