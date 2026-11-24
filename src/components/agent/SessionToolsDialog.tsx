import { useEffect, useState } from 'react';
import { ArrowRightLeft, Camera, GitMerge, History, RotateCcw, X } from 'lucide-react';
import type { AgentSession } from '../../types';
import type { CheckpointInfo } from '@shared/types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { createSessionCheckpoint, handoffAgent } from '../../lib/actions';
import { useEditorStore } from '../../store/editor';
import { useSessionStore } from '../../store/sessions';
import { toast } from '../../store/toast';
import { cn, timeAgo } from '../../lib/utils';
import { Button, Modal, Spinner } from '../ui';

type Tab = 'handoff' | 'checkpoints';

const DEFAULT_INSTRUCTION =
  'Review the changes for correctness, regressions and missed requirements. Report concrete issues with file paths and line ranges; only modify files if the task explicitly requires it.';

export function SessionToolsDialog({
  open,
  session,
  onClose,
}: {
  open: boolean;
  session: AgentSession | null;
  onClose(): void;
}) {
  const sessions = useSessionStore((state) => state.sessions);
  const [tab, setTab] = useState<Tab>('handoff');
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [target, setTarget] = useState<'new' | string>('new');
  const [busy, setBusy] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadCheckpoints = async () => {
    if (!session) return;
    setLoadingCheckpoints(true);
    try {
      setCheckpoints(await him.checkpoint.list(session.id, session.workspaceRoot));
    } catch {
      setCheckpoints([]);
    } finally {
      setLoadingCheckpoints(false);
    }
  };

  useEffect(() => {
    if (!open || !session) return;
    setTab('handoff');
    setTarget('new');
    setInstruction(DEFAULT_INSTRUCTION);
    void loadCheckpoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);

  if (!session) return null;

  const runHandoff = async () => {
    setBusy(true);
    try {
      const result = await handoffAgent(session.id, target, instruction);
      if (result) onClose();
    } finally {
      setBusy(false);
    }
  };

  const reviewCheckpoint = async (checkpoint: CheckpointInfo) => {
    setReviewingId(checkpoint.id);
    try {
      const files = await him.checkpoint.diff(session.id, session.workspaceRoot, checkpoint.id);
      if (files.length === 0) {
        toast('info', 'No changes between this checkpoint and the current workspace.', 'Checkpoint');
        return;
      }
      for (const file of files.slice(0, 10)) {
        useEditorStore
          .getState()
          .openDiff(file.path, file.before ?? '', file.after ?? '');
      }
      toast('info', `Opened ${Math.min(files.length, 10)} diff tab(s) since this checkpoint.`, 'Checkpoint');
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Checkpoint diff failed');
    } finally {
      setReviewingId(null);
    }
  };

  const revertCheckpoint = async (checkpoint: CheckpointInfo) => {
    const proceed = await him.dialog.confirm({
      title: 'Revert to checkpoint?',
      message: `Restore the workspace to “${checkpoint.label}”?`,
      detail:
        'Files changed since the checkpoint are restored, and files added since then are deleted. Checkpoint snapshots themselves are kept.',
      confirmLabel: 'Revert workspace',
      danger: true,
    });
    if (!proceed) return;
    try {
      const result = await him.checkpoint.revert(session.id, session.workspaceRoot, checkpoint.id);
      toast(
        'success',
        `Reverted: ${result.restored} file(s) restored, ${result.deleted} deleted.`,
        'Checkpoint',
      );
      await loadCheckpoints();
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Revert failed');
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide className="max-w-[720px]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <ArrowRightLeft size={14} className="text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-mist-bright">Session tools</div>
          <div className="truncate text-[9px] text-mist-faint">
            Handoff to a review agent, or review/revert checkpoints — works for HIM+, ACP and CLI
            sessions in git workspaces.
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
          aria-label="Close session tools"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-line px-3 pt-2">
        {(
          [
            ['handoff', 'Handoff', ArrowRightLeft],
            ['checkpoints', 'Checkpoints', History],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-t border-b-2 px-2.5 text-[10px]',
              tab === id
                ? 'border-accent bg-ink-850/60 text-mist-bright'
                : 'border-transparent text-mist-faint hover:text-mist',
            )}
          >
            <Icon size={10} /> {label}
          </button>
        ))}
      </div>

      {tab === 'handoff' ? (
        <div className="space-y-3 p-4">
          <div>
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Target
            </div>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="him-input h-8 w-full text-[10px]"
              style={{ colorScheme: 'dark' }}
            >
              <option value="new">New agent · Review: {session.title}</option>
              {sessions
                .filter((item) => item.id !== session.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Instruction for the receiving agent
            </div>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={4}
              className="him-input w-full resize-y font-mono text-[10px] leading-relaxed"
            />
          </div>
          <div className="flex items-start gap-2 rounded border border-line bg-ink-900/50 px-2.5 py-2 text-[8.5px] leading-relaxed text-mist-faint">
            <Camera size={10} className="mt-0.5 shrink-0 text-sand" />
            <span>
              A checkpoint is created before handoff when the workspace is a git repository. The
              receiver gets the original request, the source summary (marked untrusted), changed
              files and the checkpoint reference.
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<GitMerge size={10} />}
              loading={busy}
              onClick={() => void runHandoff()}
            >
              Handoff
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              icon={<Camera size={9} />}
              onClick={() =>
                void createSessionCheckpoint(session.id, `Manual checkpoint`).then(() =>
                  loadCheckpoints(),
                )
              }
            >
              New checkpoint
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void loadCheckpoints()}
              loading={loadingCheckpoints}
            >
              Refresh
            </Button>
            <span className="ml-auto text-[8.5px] text-mist-ghost">
              Checkpoints require git; CLI agents get one automatically before each run.
            </span>
          </div>
          {loadingCheckpoints && checkpoints.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-6 text-[10px] text-mist-faint">
              <Spinner size={10} /> Loading checkpoints…
            </div>
          )}
          {!loadingCheckpoints && checkpoints.length === 0 && (
            <div className="rounded border border-dashed border-line px-3 py-6 text-center text-[9.5px] text-mist-ghost">
              No checkpoints yet for this session. Create one before risky work, or hand off to a
              review agent.
            </div>
          )}
          <div className="thin-scrollbar max-h-[320px] space-y-1.5 overflow-y-auto">
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.id}
                className="flex items-center gap-2 rounded border border-line bg-ink-900/50 px-2.5 py-2"
              >
                <Camera size={11} className="shrink-0 text-sand" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium text-mist-bright">
                    {checkpoint.label}
                  </div>
                  <div className="font-mono text-[8px] text-mist-ghost">
                    {timeAgo(checkpoint.createdAt)} · {checkpoint.fileCount} files ·{' '}
                    {checkpoint.id.slice(0, 14)}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<History size={8} />}
                  loading={reviewingId === checkpoint.id}
                  onClick={() => void reviewCheckpoint(checkpoint)}
                >
                  Diff
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<RotateCcw size={8} />}
                  onClick={() => void revertCheckpoint(checkpoint)}
                >
                  Revert
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
