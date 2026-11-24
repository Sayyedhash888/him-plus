import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  Globe,
  History,
  MessageSquare,
  PencilLine,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { ToolCallState } from '../../types';
import { cn, truncate } from '../../lib/utils';
import { Spinner } from '../ui';

const toolIcons = {
  read_file: FileText,
  write_file: PencilLine,
  apply_patch: PencilLine,
  list_directory: FolderTree,
  search_files: Search,
  search_chats: MessageSquare,
  read_chat: History,
  web_fetch: Globe,
  git_status: GitBranch,
  git_diff: GitCompare,
  git_log: GitCommitHorizontal,
  git_commit: GitCommitHorizontal,
  get_diagnostics: AlertTriangle,
  delete_path: Trash2,
  move_path: ArrowRightLeft,
  run_terminal_command: Terminal,
} as const;

function summaryFor(call: ToolCallState): string {
  const meta = call.meta;
  if (call.name === 'run_terminal_command') return meta?.command || 'command';
  if (call.name === 'search_files' || call.name === 'search_chats') {
    return meta?.query ? `"${meta.query}"` : 'workspace search';
  }
  if (call.name === 'read_chat') return meta?.query || 'conversation';
  if (call.name === 'web_fetch') return meta?.query ? truncate(meta.query, 48) : 'web page';
  if (call.name === 'git_commit') {
    return meta?.query ? `"${truncate(meta.query, 40)}"` : 'commit';
  }
  if (meta?.path) {
    const range =
      typeof call.parsedArgs.start_line === 'number'
        ? `:${call.parsedArgs.start_line}`
        : '';
    return `${meta.path}${range}`;
  }
  return call.name;
}

function StatusIcon({ call }: { call: ToolCallState }) {
  if (call.status === 'running') return <Spinner size={11} className="text-accent" />;
  if (call.status === 'waiting') return <ShieldAlert size={11} className="text-sand" />;
  if (call.status === 'done') return <Check size={11} className="text-mint" />;
  if (call.status === 'error') return <AlertTriangle size={11} className="text-coral" />;
  if (call.status === 'rejected') return <X size={11} className="text-mist-faint" />;
  return <Clock3 size={10} className="text-mist-ghost" />;
}

const statusLabel: Record<ToolCallState['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Approval',
  done: 'Done',
  error: 'Error',
  rejected: 'Rejected',
};

export function ToolCard({
  call,
  onViewDiff,
  onViewTerminal,
}: {
  call: ToolCallState;
  onViewDiff?: (path: string) => void;
  onViewTerminal?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = toolIcons[call.name as keyof typeof toolIcons] || Wrench;
  const output = call.result || call.error || '';

  useEffect(() => {
    if (call.status === 'error') setOpen(true);
  }, [call.status]);

  const hasDiff = Boolean(
    (call.name === 'write_file' || call.name === 'apply_patch') && call.meta?.path && call.status === 'done',
  );

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-ink-850/45 transition-colors',
        call.status === 'waiting'
          ? 'border-sand/25'
          : call.status === 'running'
            ? 'border-accent/20'
            : call.status === 'error'
              ? 'border-coral/25'
              : 'border-line',
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <div
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-ink-900/70',
              call.status === 'running' && 'border-accent/20',
              call.status === 'waiting' && 'border-sand/20',
            )}
          >
            <Icon
              size={11}
              className={cn(
                'text-mist-faint',
                call.status === 'running' && 'text-accent',
                call.status === 'waiting' && 'text-sand',
                call.status === 'done' && 'text-mist-dim',
              )}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[9.5px] text-mist-faint">{call.name}</span>
            <span className="truncate font-mono text-[10px] text-mist">
              {truncate(summaryFor(call), 150)}
            </span>
          </div>
          {call.meta?.added !== undefined && (call.meta.added > 0 || call.meta.removed! > 0) && (
            <span className="hidden shrink-0 items-center gap-1 font-mono text-[9px] sm:flex">
              <span className="text-mint">+{call.meta.added}</span>
              <span className="text-coral/80">−{call.meta.removed || 0}</span>
            </span>
          )}
          {call.meta?.exitCode !== undefined && call.meta.exitCode !== null && (
            <span
              className={cn(
                'shrink-0 rounded border px-1 py-px font-mono text-[8.5px]',
                call.meta.exitCode === 0
                  ? 'border-mint/20 bg-mint/[0.05] text-mint'
                  : 'border-coral/25 bg-coral/[0.06] text-coral-soft',
              )}
            >
              exit {call.meta.exitCode}
            </span>
          )}
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-[8.5px]',
              call.status === 'waiting'
                ? 'text-sand'
                : call.status === 'running'
                  ? 'text-accent'
                  : call.status === 'error'
                    ? 'text-coral'
                    : call.status === 'done'
                      ? 'text-mist-faint'
                      : 'text-mist-ghost',
            )}
          >
            <StatusIcon call={call} />
            <span className="hidden md:inline">{statusLabel[call.status]}</span>
          </span>
          <ChevronRight
            size={10}
            className={cn(
              'shrink-0 text-mist-ghost transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>
        {hasDiff && onViewDiff && (
          <button
            onClick={() => onViewDiff(call.meta!.path!)}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[8.5px] text-mist-faint transition-colors hover:border-accent/25 hover:text-accent-soft"
          >
            View diff
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-line/80 bg-ink-950/40">
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-[8.5px] uppercase tracking-[0.14em] text-mist-ghost">
              {call.status === 'running' ? 'Streaming output' : 'Output'}
            </span>
            <div className="flex items-center gap-1">
              {call.name === 'run_terminal_command' && onViewTerminal && (
                <button
                  onClick={onViewTerminal}
                  className="rounded px-1.5 py-0.5 text-[8.5px] text-mist-ghost hover:bg-ink-800 hover:text-mist"
                >
                  Terminal tab
                </button>
              )}
              {output && (
                <button
                  onClick={() => void copyOutput()}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[8.5px] text-mist-ghost hover:bg-ink-800 hover:text-mist"
                >
                  {copied ? <Check size={9} className="text-mint" /> : <Copy size={9} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <pre className="thin-scrollbar max-h-[220px] overflow-auto px-2.5 pb-2 font-mono text-[10px] leading-[1.7] text-mist-dim">
            {output || (call.status === 'running' ? 'Working…' : 'No output yet.')}
          </pre>
        </div>
      )}
    </div>
  );
}
