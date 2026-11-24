import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  Check,
  CheckCheck,
  ChevronRight,
  Columns2,
  Eraser,
  FileDiff,
  ListChecks,
  MessageSquare,
  Plus,
  RotateCcw,
  Rows3,
  Terminal,
  X,
} from 'lucide-react';
import type { AgentChange, AgentSession, Artifact } from '../../types';
import {
  cn,
  formatTokens,
  languageForPath,
  timeAgo,
  truncate,
} from '../../lib/utils';
import { him } from '../../lib/bridge';
import {
  acceptAllChanges,
  acceptChange,
  revertAllChanges,
  revertChange,
  sendArtifactFeedback,
} from '../../lib/actions';
import { useAgentUiStore } from '../../store/agentUi';
import { useSessionStore } from '../../store/sessions';
import { Button, IconButton, MarkdownView, Spinner } from '../ui';
import { useAppTheme } from '../../lib/useTheme';
import { monacoThemeName } from '../../lib/themes';

function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-ink-850 text-mist-faint">
        {icon}
      </div>
      <div className="text-[11.5px] font-medium text-mist">{title}</div>
      <p className="mt-1 max-w-[260px] text-[9.5px] leading-relaxed text-mist-faint">
        {description}
      </p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function ArtifactCard({ session, artifact }: { session: AgentSession; artifact: Artifact }) {
  const addArtifactComment = useSessionStore((state) => state.addArtifactComment);
  const [comment, setComment] = useState('');
  const running = session.status === 'running' || session.status === 'waiting';
  const unsent = artifact.comments.filter((item) => !item.sent);

  const submitComment = () => {
    if (!comment.trim()) return;
    addArtifactComment(session.id, artifact.id, comment.trim());
    setComment('');
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-ink-900/40">
      <div className="flex items-start gap-2.5 border-b border-line/70 px-3 py-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/[0.05] text-accent">
          <ListChecks size={12} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-mist-bright">{artifact.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[8.5px] text-mist-ghost">
            <span className="uppercase tracking-[0.1em]">{artifact.kind}</span>
            <span>·</span>
            <span>{timeAgo(artifact.updatedAt)}</span>
            <span>·</span>
            <span>{artifact.content.split('\n').length} lines</span>
          </div>
        </div>
      </div>
      <div className="thin-scrollbar max-h-[280px] overflow-y-auto px-3 py-2.5">
        <MarkdownView content={artifact.content} />
      </div>
      <div className="border-t border-line/70 bg-ink-850/30 px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <MessageSquare size={9} className="text-mist-ghost" />
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-mist-ghost">
            Feedback
          </span>
          <span className="font-mono text-[8px] text-mist-ghost">
            {artifact.comments.length}
          </span>
        </div>
        {artifact.comments.length > 0 && (
          <div className="mb-2 space-y-1">
            {artifact.comments.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-1.5 rounded border border-line/70 bg-ink-900/50 px-2 py-1.5 text-[9.5px] leading-relaxed text-mist-dim"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-mist-ghost" />
                <span className="min-w-0 flex-1 break-word">{item.body}</span>
                {item.sent && <Check size={9} className="mt-0.5 shrink-0 text-mint" />}
              </div>
            ))}
          </div>
        )}
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submitComment();
            }
          }}
          rows={2}
          placeholder="Leave inline feedback for this artifact…"
          className="him-input him-textarea text-[10px] leading-relaxed"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={submitComment}
            disabled={!comment.trim()}
            icon={<Plus size={9} />}
          >
            Add comment
          </Button>
          {unsent.length > 0 && (
            <Button
              size="xs"
              variant="primary"
              disabled={running}
              onClick={() => sendArtifactFeedback(session.id, artifact.id)}
              title={running ? 'Stop the agent before sending feedback' : 'Send feedback to the agent'}
            >
              Send to agent
            </Button>
          )}
          {artifact.comments.length > 0 && unsent.length === 0 && (
            <span className="ml-auto flex items-center gap-1 text-[8.5px] text-mint/70">
              <Check size={8} /> sent
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactsPanel({ session }: { session: AgentSession }) {
  if (session.artifacts.length === 0) {
    return (
      <EmptyPanel
        icon={<ListChecks size={16} />}
        title="No artifacts yet"
        description="Structured plans, architecture notes and checklists produced by the agent land here. You can also save any assistant message."
      />
    );
  }
  return (
    <div className="thin-scrollbar h-full overflow-y-auto p-2.5">
      <div className="space-y-2">
        {session.artifacts.map((artifact) => (
          <ArtifactCard key={artifact.id} session={session} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}

function changeIcon(change: AgentChange) {
  if (change.status === 'accepted') return <Check size={10} className="text-mint" />;
  if (change.status === 'reverted') return <RotateCcw size={10} className="text-coral" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-sand" />;
}

function ChangesPanel({ session }: { session: AgentSession }) {
  const selectedMap = useAgentUiStore((state) => state.selectedChange);
  const selectChange = useAgentUiStore((state) => state.selectChange);
  const appTheme = useAppTheme();
  const [sideBySide, setSideBySide] = useState(false);
  const selected = session.changes.find(
    (change) => change.path === selectedMap[session.id],
  ) || null;
  const pending = session.changes.filter((change) => change.status === 'pending');
  const totals = session.changes.reduce(
    (acc, change) => {
      acc.added += change.added;
      acc.removed += change.removed;
      return acc;
    },
    { added: 0, removed: 0 },
  );

  useEffect(() => {
    if (selected) return;
    if (session.changes.length === 0) return;
    const next = pending[0] || session.changes[session.changes.length - 1];
    if (next) selectChange(session.id, next.path);
  }, [selected, session.changes, session.id, selectChange, pending]);

  if (session.changes.length === 0) {
    return (
      <EmptyPanel
        icon={<FileDiff size={16} />}
        title="No file changes yet"
        description="When the agent writes or patches a file, its diff appears here for granular review. Changes are written to disk immediately."
      />
    );
  }

  const handleRevert = async () => {
    if (!selected) return;
    const proceed = await him.dialog.confirm({
      title: 'Revert this file?',
      message: `Revert ${selected.path} to its previous content?`,
      detail:
        selected.kind === 'added'
          ? 'The added file will be moved to the OS recycle bin.'
          : 'The current file content will be overwritten with the pre-change snapshot.',
      confirmLabel: 'Revert file',
      danger: true,
    });
    if (proceed) await revertChange(session.id, selected.path);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[8.5px]">
            <span className="text-mist-faint">
              {pending.length} pending
            </span>
            <span className="text-mist-ghost">·</span>
            <span className="font-mono text-mint">+{totals.added}</span>
            <span className="font-mono text-coral/80">−{totals.removed}</span>
            <span className="text-mist-ghost">·</span>
            <span className="text-mist-ghost">
              {session.changes.filter((change) => change.status === 'accepted').length} accepted
            </span>
          </div>
          <Button
            size="xs"
            variant="ghost"
            icon={<RotateCcw size={10} />}
            disabled={pending.length === 0}
            onClick={() => void revertAllChanges(session.id)}
            title="Restore every pending file to its pre-agent content"
          >
            Revert all
          </Button>
          <Button
            size="xs"
            variant="accent"
            icon={<CheckCheck size={10} />}
            disabled={pending.length === 0}
            onClick={() => acceptAllChanges(session.id)}
          >
            Accept all
          </Button>
        </div>
        <div className="thin-scrollbar max-h-[178px] overflow-y-auto border-t border-line/60">
          {session.changes.map((change) => {
            const active = selected?.path === change.path;
            return (
              <button
                key={change.path}
                onClick={() => selectChange(session.id, change.path)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 border-b border-line/50 px-3 text-left transition-colors last:border-0',
                  active ? 'bg-ink-750/80' : 'hover:bg-ink-800/60',
                )}
              >
                <span className="flex w-3 shrink-0 items-center justify-center">
                  {changeIcon(change)}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded border px-1 text-[7.5px] font-semibold uppercase',
                    change.kind === 'added'
                      ? 'border-mint/25 bg-mint/[0.05] text-mint'
                      : 'border-sand/20 bg-sand/[0.04] text-sand',
                  )}
                >
                  {change.kind === 'added' ? 'A' : 'M'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-mist">
                  {change.path}
                </span>
                {change.status === 'reverted' && (
                  <span className="shrink-0 text-[8px] text-coral/70">reverted</span>
                )}
                {change.status === 'accepted' && (
                  <span className="shrink-0 text-[8px] text-mint/70">accepted</span>
                )}
                <span className="shrink-0 font-mono text-[8.5px]">
                  <span className="text-mint/80">+{change.added}</span>{' '}
                  <span className="text-coral/70">−{change.removed}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-line/60 px-3 py-1.5">
          <span className="text-[8px] text-mist-ghost">Unified or split diff</span>
          <div className="flex rounded border border-line bg-ink-850 p-0.5">
            <button
              onClick={() => setSideBySide(false)}
              className={cn(
                'flex h-5 items-center gap-1 rounded px-1.5 text-[8.5px]',
                !sideBySide ? 'bg-ink-700 text-mist' : 'text-mist-ghost',
              )}
            >
              <Rows3 size={9} /> Unified
            </button>
            <button
              onClick={() => setSideBySide(true)}
              className={cn(
                'flex h-5 items-center gap-1 rounded px-1.5 text-[8.5px]',
                sideBySide ? 'bg-ink-700 text-mist' : 'text-mist-ghost',
              )}
            >
              <Columns2 size={9} /> Split
            </button>
          </div>
        </div>
      </div>

      {selected ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 diff-editor-shell bg-ink-950/50">
              <DiffEditor
                height="100%"
                theme={monacoThemeName(appTheme)}
                original={selected.before}
                modified={selected.after}
                language={languageForPath(selected.path)}
                originalModelPath={`inmemory://him/orig/${session.id}/${encodeURIComponent(selected.path)}`}
                modifiedModelPath={`inmemory://him/mod/${session.id}/${encodeURIComponent(selected.path)}`}
                options={{
                  readOnly: true,
                  renderSideBySide: sideBySide,
                  minimap: { enabled: false },
                  fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
                  fontSize: 11,
                  lineHeight: 18,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  renderOverviewRuler: false,
                  overviewRulerBorder: false,
                  scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
                  diffWordWrap: 'on',
                  wordWrap: 'on',
                  renderLineHighlight: 'none',
                  contextmenu: false,
                  glyphMargin: false,
                  folding: false,
                  padding: { top: 8, bottom: 8 },
                  lineNumbersMinChars: 3,
                }}
              />
            </div>
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-t border-line bg-ink-900/60 px-2.5">
              <span
                className={cn(
                  'text-[8.5px]',
                  selected.status === 'pending'
                    ? 'text-sand'
                    : selected.status === 'accepted'
                      ? 'text-mint'
                      : 'text-coral',
                )}
              >
                {selected.status === 'pending'
                  ? 'Pending review'
                  : selected.status === 'accepted'
                    ? 'Accepted'
                    : 'Reverted'}
              </span>
              <span className="ml-auto" />
              <Button
                size="xs"
                variant="ghost"
                icon={<RotateCcw size={10} />}
                onClick={() => void handleRevert()}
                disabled={selected.status === 'reverted' && selected.kind === 'added'}
              >
                Revert file
              </Button>
              <Button
                size="xs"
                variant="primary"
                icon={<Check size={10} />}
                disabled={selected.status === 'accepted'}
                onClick={() => void acceptChange(session.id, selected.path)}
              >
                Accept file
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[10px] text-mist-ghost">
          Select a changed file to inspect its diff.
        </div>
      )}
    </div>
  );
}

function TerminalPanel({ session }: { session: AgentSession }) {
  const clearTerminalRuns = useSessionStore((state) => state.clearTerminalRuns);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const runs = session.terminalRuns;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (stickRef.current) element.scrollTop = element.scrollHeight;
  }, [runs]);

  if (runs.length === 0) {
    return (
      <EmptyPanel
        icon={<Terminal size={16} />}
        title="No commands yet"
        description="Shell commands executed by this agent stream here. Destructive commands pause for approval even in Auto mode."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[8.5px] text-mist-faint">
          {runs.length} command{runs.length === 1 ? '' : 's'}
        </span>
        {runs.some((run) => run.running) && (
          <span className="flex items-center gap-1 text-[8px] text-accent/70">
            <Spinner size={8} /> live
          </span>
        )}
        <button
          onClick={() => clearTerminalRuns(session.id)}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[8.5px] text-mist-ghost hover:bg-ink-800 hover:text-mist"
        >
          <Eraser size={9} /> Clear
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5"
      >
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className={cn(
                'overflow-hidden rounded-md border bg-ink-950/50',
                run.running ? 'border-accent/20' : 'border-line',
              )}
            >
              <div className="flex items-center gap-2 border-b border-line/60 bg-ink-900/50 px-2.5 py-1.5">
                <span className="shrink-0 font-mono text-[9px] text-accent">$</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-mist">
                  {run.command}
                </span>
                {run.running ? (
                  <Spinner size={9} />
                ) : (
                  <span
                    className={cn(
                      'shrink-0 rounded border px-1 py-px font-mono text-[8px]',
                      run.code === 0
                        ? 'border-mint/20 text-mint/80'
                        : 'border-coral/25 text-coral-soft',
                    )}
                  >
                    exit {run.code ?? '—'}
                  </span>
                )}
              </div>
              <div className="px-2 pb-1 pt-1 font-mono text-[8px] text-mist-ghost">
                {run.cwd}
              </div>
              <pre className="thin-scrollbar max-h-[240px] overflow-auto whitespace-pre px-2.5 pb-2 font-mono text-[9.5px] leading-[1.65] text-mist-dim">
                {run.output || (run.running ? 'Streaming output…' : '(no output)')}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgentInspector({
  session,
  width = 420,
}: {
  session: AgentSession;
  width?: number;
}) {
  const tab = useAgentUiStore((state) => state.tab);
  const setTab = useAgentUiStore((state) => state.setTab);
  const setInspectorOpen = useAgentUiStore((state) => state.setInspectorOpen);
  const pendingChanges = session.changes.filter((change) => change.status === 'pending').length;
  const tabs = useMemo(
    () => [
      {
        key: 'artifacts' as const,
        label: 'Artifacts',
        icon: ListChecks,
        count: session.artifacts.length,
      },
      {
        key: 'changes' as const,
        label: 'Changes',
        icon: FileDiff,
        count: session.changes.length,
        highlight: pendingChanges,
      },
      {
        key: 'terminal' as const,
        label: 'Terminal',
        icon: Terminal,
        count: session.terminalRuns.length,
      },
    ],
    [session.artifacts.length, session.changes.length, session.terminalRuns.length, pendingChanges],
  );

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-l border-line bg-ink-850/30"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-line bg-ink-900/30">
        <div className="flex h-full flex-1 items-center">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={cn(
                  'relative flex h-full flex-1 items-center justify-center gap-1.5 text-[9.5px] transition-colors',
                  active ? 'text-mist-bright' : 'text-mist-faint hover:text-mist',
                )}
              >
                <Icon size={11} className={active ? 'text-accent' : ''} />
                <span>{item.label}</span>
                {item.count > 0 && (
                  <span
                    className={cn(
                      'rounded px-1 py-px font-mono text-[8px]',
                      active ? 'bg-ink-750 text-mist' : 'text-mist-ghost',
                      item.highlight ? 'text-sand' : '',
                    )}
                  >
                    {item.highlight ? item.highlight : item.count}
                  </span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-px bg-accent/60" />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex h-full w-8 items-center justify-center">
          <IconButton
            label="Collapse inspector"
            size="xs"
            onClick={() => setInspectorOpen(false)}
          >
            <X size={11} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'artifacts' && <ArtifactsPanel session={session} />}
        {tab === 'changes' && <ChangesPanel session={session} />}
        {tab === 'terminal' && <TerminalPanel session={session} />}
      </div>
    </aside>
  );
}
