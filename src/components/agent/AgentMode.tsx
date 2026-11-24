import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitFork,
  GitMerge,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  ShieldAlert,
  Square,
  XCircle,
  Clock3,
} from 'lucide-react';
import type { AgentSession } from '../../types';
import { cn, formatCost, formatTokens, timeAgo } from '../../lib/utils';
import { useAgentUiStore } from '../../store/agentUi';
import { useCoreStore } from '../../store/core';
import { useSessionStore } from '../../store/sessions';
import { renameAgent, stopCliAgentSession } from '../../lib/actions';
import { stopAgent } from '../../lib/agent/runtime';
import { AgentComposer, type ComposerSeed } from './AgentComposer';
import { AgentInspector } from './AgentInspector';
import { AgentSidebar } from './AgentSidebar';
import { ChatTimeline } from './ChatTimeline';
import { CliAgentView } from './CliAgentView';
import { SessionToolsDialog } from './SessionToolsDialog';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { usePanelSize } from '../../lib/usePanelSize';
import { IconButton, Spinner, StatusDot } from '../ui';

function statusDisplay(status: AgentSession['status']): {
  label: string;
  tone: 'accent' | 'mint' | 'sand' | 'coral' | 'muted';
  pulse: boolean;
} {
  switch (status) {
    case 'running':
      return { label: 'Running', tone: 'accent', pulse: true };
    case 'waiting':
      return { label: 'Awaiting approval', tone: 'sand', pulse: true };
    case 'completed':
      return { label: 'Complete', tone: 'mint', pulse: false };
    case 'error':
      return { label: 'Error', tone: 'coral', pulse: false };
    case 'stopped':
      return { label: 'Stopped', tone: 'muted', pulse: false };
    default:
      return { label: 'Ready', tone: 'muted', pulse: false };
  }
}

function AgentHeader({
  session,
  inspectorOpen,
  onOpenTools,
}: {
  session: AgentSession | null;
  inspectorOpen: boolean;
  onOpenTools(): void;
}) {
  const git = useCoreStore((state) => state.git);
  const sessions = useSessionStore((state) => state.sessions);
  const setInspectorOpen = useAgentUiStore((state) => state.setInspectorOpen);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session?.title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditing(false);
    setTitle(session?.title || '');
  }, [session?.id, session?.title]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    if (session && title.trim() && title.trim() !== session.title) {
      renameAgent(session.id, title);
    }
    setEditing(false);
  };

  if (!session) {
    return (
      <div className="flex h-11 shrink-0 items-center border-b border-line bg-ink-900/60 px-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[11px] font-medium text-mist">Mission Control</span>
          <span className="text-[9px] text-mist-ghost">select or spawn an agent</span>
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[8.5px] text-mist-ghost">
          {sessions.length} sessions
        </span>
      </div>
    );
  }

  const status = statusDisplay(session.status);
  const branch = session.worktree?.branch || session.branch || git?.branch || null;
  const tokens = session.tokens.input + session.tokens.output;
  const cost = formatCost(session.tokens.cost);
  const running = session.status === 'running' || session.status === 'waiting';
  const sharedRunning = sessions.filter(
    (item) => item.status === 'running' && !item.worktree,
  ).length;

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-line bg-ink-900/60 px-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <StatusDot tone={status.tone} pulse={status.pulse} />
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setTitle(session.title);
                setEditing(false);
              }
            }}
            className="h-6 w-[240px] rounded border border-accent/30 bg-ink-850 px-1.5 text-[11px] font-medium text-mist-bright outline-none"
          />
        ) : (
          <button
            onDoubleClick={() => setEditing(true)}
            className="group flex min-w-0 items-center gap-1.5"
            title="Double-click to rename"
          >
            <span className="max-w-[260px] truncate text-[11px] font-medium text-mist-bright">
              {session.title}
            </span>
            {session.backend === 'acp' && (
              <span className="shrink-0 rounded border border-accent/20 bg-accent/[0.05] px-1 py-px font-mono text-[7px] uppercase tracking-wide text-accent-soft">
                ACP
              </span>
            )}
            {session.backend === 'cli' && (
              <span className="shrink-0 rounded border border-sand/20 bg-sand/[0.05] px-1 py-px font-mono text-[7px] uppercase tracking-wide text-sand-soft">
                CLI
              </span>
            )}
            <Pencil
              size={9}
              className="shrink-0 text-mist-ghost opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        )}
        <span
          className={cn(
            'hidden items-center gap-1 text-[8.5px] sm:flex',
            status.tone === 'sand'
              ? 'text-sand'
              : status.tone === 'coral'
                ? 'text-coral'
                : status.tone === 'mint'
                  ? 'text-mint/80'
                  : 'text-mist-ghost',
          )}
        >
          {session.status === 'waiting' && <ShieldAlert size={8} />}
          {session.status === 'error' && <AlertTriangle size={8} />}
          {session.status === 'completed' && <CheckCircle2 size={8} />}
          {session.status === 'stopped' && <XCircle size={8} />}
          {session.status === 'running' && <Spinner size={8} />}
          {status.label}
        </span>
        <span className="hidden font-mono text-[8px] text-mist-ghost lg:inline">
          {timeAgo(session.updatedAt)}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        {branch && (
          <span
            className={cn(
              'hidden max-w-[180px] items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px] md:flex',
              session.worktree
                ? 'border-mint/20 bg-mint/[0.04] text-mint/80'
                : 'border-line bg-ink-850/60 text-mist-faint',
            )}
            title={session.worktree ? session.worktree.path : `Shared workspace · ${branch}`}
          >
            {session.worktree ? <GitFork size={8} /> : <GitBranch size={8} />}
            <span className="truncate">{branch}</span>
            {session.worktree && (
              <span className="rounded border border-mint/20 px-0.5 text-[7px] uppercase">
                wt
              </span>
            )}
            {!session.worktree && sharedRunning > 1 && (
              <AlertTriangle size={8} className="ml-0.5 text-sand" />
            )}
          </span>
        )}
        <span className="hidden items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[8.5px] text-mist-ghost xl:flex">
          {formatTokens(tokens)} tok{cost ? ` · ${cost}` : ''}
        </span>
        {running && (
          <button
            onClick={() =>
              void (session.backend === 'cli' ? stopCliAgentSession(session.id) : stopAgent(session.id))
            }
            className="flex h-6 items-center gap-1 rounded border border-line bg-ink-850 px-1.5 text-[8.5px] text-mist-faint transition-colors hover:border-coral/30 hover:text-coral-soft"
            title="Stop this agent"
          >
            <Square size={7} fill="currentColor" /> Stop
          </button>
        )}
        {session.pendingApproval && (
          <span className="flex h-6 items-center gap-1 rounded border border-sand/25 bg-sand/[0.04] px-1.5 text-[8.5px] text-sand">
            <Clock3 size={8} /> review
          </span>
        )}
        <IconButton
          label="Session tools: handoff and checkpoints"
          size="xs"
          onClick={onOpenTools}
        >
          <GitMerge size={12} />
        </IconButton>
        <IconButton
          label={inspectorOpen ? 'Collapse inspector' : 'Open inspector'}
          size="xs"
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          {inspectorOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
        </IconButton>
      </div>
    </div>
  );
}

export function AgentMode() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const session = sessions.find((item) => item.id === activeId) || null;
  const inspectorOpen = useAgentUiStore((state) => state.inspectorOpen);
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const sidebar = usePanelSize({
    key: 'agent.sidebar',
    initial: 272,
    min: 220,
    max: 460,
    side: 'left',
  });
  const inspector = usePanelSize({
    key: 'agent.inspector',
    initial: 420,
    min: 340,
    max: 860,
    side: 'right',
  });

  return (
    <div className="flex h-full min-h-0 bg-ink-900">
      <AgentSidebar width={sidebar.size} />
      <PanelResizeHandle onStart={sidebar.startResize} onReset={sidebar.reset} />
      <section className="relative flex min-w-0 flex-1 flex-col">
        <AgentHeader
          session={session}
          inspectorOpen={inspectorOpen}
          onOpenTools={() => setToolsOpen(true)}
        />
        {session?.backend === 'cli' ? (
          <CliAgentView session={session} />
        ) : (
          <>
            <ChatTimeline
              session={session}
              onSeedPrompt={(text) =>
                setSeed({ text, nonce: Date.now() + Math.random() })
              }
            />
            {session && <AgentComposer session={session} seed={seed} />}
          </>
        )}
      </section>
      {session && inspectorOpen && session.backend !== 'cli' && (
        <PanelResizeHandle onStart={inspector.startResize} onReset={inspector.reset} />
      )}
      {session && inspectorOpen && session.backend !== 'cli' && (
        <AgentInspector session={session} width={inspector.size} />
      )}
      <SessionToolsDialog
        open={toolsOpen && Boolean(session)}
        session={session}
        onClose={() => setToolsOpen(false)}
      />
    </div>
  );
}
