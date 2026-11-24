import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitFork,
  Plug,
  Plus,
  Settings2,
  ShieldAlert,
  Square,
  TerminalSquare,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AgentSession } from '../../types';
import { cn, formatCost, formatTokens, timeAgo } from '../../lib/utils';
import { useConfigStore, providerModelOptions } from '../../store/config';
import { useCoreStore } from '../../store/core';
import { useSessionStore } from '../../store/sessions';
import { createAgent, openWorkspace, removeAgent, stopCliAgentSession } from '../../lib/actions';
import { stopAgent } from '../../lib/agent/runtime';
import { useClickOutside } from '../../lib/hooks';
import { SectionLabel, Spinner, StatusDot } from '../ui';

function statusTone(session: AgentSession): {
  dot: 'accent' | 'mint' | 'sand' | 'coral' | 'muted';
  pulse: boolean;
  label: string;
  icon?: typeof CheckCircle2;
} {
  switch (session.status) {
    case 'running':
      return { dot: 'accent', pulse: true, label: 'running' };
    case 'waiting':
      return { dot: 'sand', pulse: true, label: 'approval', icon: ShieldAlert };
    case 'completed':
      return { dot: 'mint', pulse: false, label: 'completed', icon: CheckCircle2 };
    case 'error':
      return { dot: 'coral', pulse: false, label: 'error', icon: AlertTriangle };
    case 'stopped':
      return { dot: 'muted', pulse: false, label: 'stopped', icon: XCircle };
    default:
      return { dot: 'muted', pulse: false, label: 'queued' };
  }
}

export function AgentSidebar({ width = 272 }: { width?: number }) {
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const setActive = useSessionStore((state) => state.setActive);
  const git = useCoreStore((state) => state.git);
  const workspace = useCoreStore((state) => state.workspace);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const config = useConfigStore((state) => state.config);
  const enabledModels = providerModelOptions(config).length;
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState<'shared' | 'worktree' | 'acp' | 'cli' | null>(null);
  const [, setTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const spawn = async (
    options: { isolated?: boolean; acpProfileId?: string; cliProfileId?: string } = {},
  ) => {
    setCreating(
      options.cliProfileId
        ? 'cli'
        : options.acpProfileId
          ? 'acp'
          : options.isolated
            ? 'worktree'
            : 'shared',
    );
    try {
      await createAgent(options);
      setMenuOpen(false);
    } finally {
      setCreating(null);
    }
  };

  const acpProfiles = (config?.acpAgents || []).filter(
    (profile) => profile.enabled && profile.command.trim(),
  );
  const cliProfiles = (config?.cliAgents || []).filter(
    (profile) => profile.enabled && profile.command.trim(),
  );

  const runningShared = sessions.filter(
    (session) => session.status === 'running' && !session.worktree,
  ).length;

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-line bg-ink-850/45"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2">
          <SectionLabel>Agents</SectionLabel>
          <span className="rounded border border-line bg-ink-850 px-1.5 py-px font-mono text-[8.5px] text-mist-ghost">
            {sessions.length}
          </span>
        </div>
        {sessions.some((session) => session.status === 'waiting') && (
          <span className="flex items-center gap-1 text-[8.5px] text-sand">
            <StatusDot tone="sand" />
            approval
          </span>
        )}
      </div>

      <div ref={menuRef} className="relative shrink-0 px-2.5 pb-1.5 pt-2.5">
        <div className="flex h-8 overflow-hidden rounded-md border border-line-strong bg-ink-750 shadow-inset">
          <button
            data-testid="new-agent"
            onClick={() => void spawn({})}
            disabled={Boolean(creating) || !workspace}
            className="flex flex-1 items-center justify-center gap-1.5 text-[10.5px] font-medium text-mist transition-colors hover:bg-ink-700 disabled:opacity-40"
          >
            {creating ? <Spinner size={11} /> : <Plus size={12} className="text-accent" />}
            New agent
          </button>
          <button
            onClick={() => setMenuOpen((value) => !value)}
            disabled={Boolean(creating) || !workspace}
            className="flex w-7 items-center justify-center border-l border-line-strong text-mist-faint transition-colors hover:bg-ink-700 hover:text-mist disabled:opacity-40"
            aria-label="Agent workspace options"
          >
            <ChevronDown
              size={11}
              className={cn('transition-transform', menuOpen && 'rotate-180')}
            />
          </button>
        </div>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-[70]"
              onMouseDown={() => setMenuOpen(false)}
              aria-hidden
            />
            <div className="absolute left-2.5 right-2.5 top-full z-[80] mt-1 animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 p-1 shadow-panel">
              <button
                onClick={() => void spawn({})}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-ink-750"
              >
                <FolderGit2 size={13} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  <span className="block text-[10.5px] font-medium text-mist-bright">
                    Shared workspace
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-relaxed text-mist-faint">
                    Edits land in the open folder. Best for a single active agent.
                  </span>
                </span>
              </button>
              <button
                onClick={() => void spawn({ isolated: true })}
                disabled={!git?.isRepo}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-ink-750 disabled:opacity-40"
              >
                <GitFork size={13} className="mt-0.5 shrink-0 text-mint" />
                <span>
                  <span className="block text-[10.5px] font-medium text-mist-bright">
                    Isolated git worktree
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-relaxed text-mist-faint">
                    {git?.isRepo
                      ? 'Fresh branch from HEAD in a separate folder.'
                      : 'Requires a git repository with at least one commit.'}
                  </span>
                </span>
              </button>
              {(acpProfiles.length > 0 || cliProfiles.length > 0) && (
                <>
                  <div className="mx-2 my-1 h-px bg-line" />
                  {acpProfiles.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-mist-ghost">
                        ACP agents
                      </div>
                      <div className="thin-scrollbar max-h-[190px] overflow-y-auto">
                        {acpProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            onClick={() => void spawn({ acpProfileId: profile.id })}
                            disabled={Boolean(creating) || !workspace}
                            className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750 disabled:opacity-40"
                          >
                            <Plug size={12} className="mt-0.5 shrink-0 text-accent" />
                            <span className="min-w-0">
                              <span className="block truncate text-[10px] font-medium text-mist-bright">
                                {profile.name}
                              </span>
                              <span className="mt-0.5 block truncate font-mono text-[8px] text-mist-ghost">
                                {profile.command} {profile.args.join(' ')}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {cliProfiles.length > 0 && (
                    <>
                      <div className="mt-1 px-2 pb-1 pt-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-mist-ghost">
                        CLI agents
                      </div>
                      <div className="thin-scrollbar max-h-[190px] overflow-y-auto">
                        {cliProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            onClick={() => void spawn({ cliProfileId: profile.id })}
                            disabled={Boolean(creating) || !workspace}
                            className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750 disabled:opacity-40"
                          >
                            <TerminalSquare size={12} className="mt-0.5 shrink-0 text-sand" />
                            <span className="min-w-0">
                              <span className="block truncate text-[10px] font-medium text-mist-bright">
                                {profile.name}
                              </span>
                              <span className="mt-0.5 block truncate font-mono text-[8px] text-mist-ghost">
                                {profile.command} {profile.args.join(' ')}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {runningShared > 1 && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded border border-sand/20 bg-sand/[0.035] px-2 py-1.5 text-[8.5px] leading-relaxed text-sand-soft">
            <AlertTriangle size={9} className="mt-0.5 shrink-0" />
            {runningShared} agents share this workspace. Use worktrees for hard isolation.
          </div>
        )}
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {sessions.length === 0 && (
          <div className="px-3 py-6">
            <div className="text-[10.5px] font-medium text-mist">No agents yet</div>
            <p className="mt-1 text-[9.5px] leading-relaxed text-mist-faint">
              Spawn a focused agent for the current workspace. Running agents stream in parallel.
            </p>
          </div>
        )}
        {sessions.map((session) => {
          const tone = statusTone(session);
          const StatusIcon = tone.icon;
          const active = session.id === activeId;
          const branch = session.worktree?.branch || session.branch || git?.branch;
          const tokens = session.tokens.input + session.tokens.output;
          const cost = formatCost(session.tokens.cost);
          return (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              onClick={() => setActive(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActive(session.id);
                }
              }}
              className={cn(
                'group relative mb-0.5 cursor-default rounded-md border px-2.5 py-2 outline-none transition-colors focus-visible:border-accent/40',
                active
                  ? 'border-line-strong bg-ink-800 shadow-inset'
                  : 'border-transparent hover:border-line hover:bg-ink-800/55',
                session.status === 'waiting' && !active && 'border-sand/15',
              )}
            >
              {active && (
                <span className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-accent" />
              )}
              <div className="flex items-center gap-1.5">
                <StatusDot tone={tone.dot} pulse={tone.pulse} />
                <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-mist-bright">
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
                <span className="shrink-0 font-mono text-[8px] text-mist-ghost group-hover:invisible">
                  {timeAgo(session.updatedAt)}
                </span>
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {(session.status === 'running' || session.status === 'waiting') && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        if (session.backend === 'cli') void stopCliAgentSession(session.id);
                        else stopAgent(session.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded border border-line bg-ink-800 text-mist-faint hover:border-coral/30 hover:text-coral-soft"
                      title="Stop agent"
                      aria-label="Stop agent"
                    >
                      <Square size={7} fill="currentColor" />
                    </button>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeAgent(session.id);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded border border-line bg-ink-800 text-mist-faint hover:border-coral/30 hover:text-coral-soft"
                    title="Remove agent"
                    aria-label="Remove agent"
                  >
                    <Trash2 size={8} />
                  </button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1 pl-3 text-[8.5px]">
                {StatusIcon ? (
                  <StatusIcon
                    size={8}
                    className={cn(
                      tone.dot === 'sand'
                        ? 'text-sand'
                        : tone.dot === 'coral'
                          ? 'text-coral'
                          : tone.dot === 'mint'
                            ? 'text-mint'
                            : 'text-mist-ghost',
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      'h-1 w-1 rounded-full',
                      tone.dot === 'accent' ? 'bg-accent' : 'bg-mist-ghost',
                    )}
                  />
                )}
                <span
                  className={cn(
                    tone.dot === 'sand'
                      ? 'text-sand/80'
                      : tone.dot === 'coral'
                        ? 'text-coral/80'
                        : 'text-mist-ghost',
                  )}
                >
                  {tone.label}
                </span>
                <span className="text-line">·</span>
                {session.worktree ? (
                  <span
                    className="flex min-w-0 items-center gap-1 text-mint/70"
                    title={`${session.worktree.path}\n${session.worktree.branch}`}
                  >
                    <GitFork size={8} className="shrink-0" />
                    <span className="max-w-[92px] truncate font-mono">
                      {session.worktree.branch.replace(/^him\//, '')}
                    </span>
                    <span className="rounded border border-mint/20 px-0.5 text-[7px] uppercase tracking-wide">
                      wt
                    </span>
                  </span>
                ) : branch ? (
                  <span className="flex min-w-0 items-center gap-1 text-mist-ghost">
                    <GitBranch size={8} className="shrink-0" />
                    <span className="max-w-[98px] truncate font-mono">{branch}</span>
                  </span>
                ) : (
                  <span className="text-mist-ghost">shared</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[8px] text-mist-ghost">
                  {session.tokens.estimated ? '~' : ''}
                  {formatTokens(tokens)} tok{cost ? ` · ${cost}` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[9.5px] text-mist-faint transition-colors hover:bg-ink-800 hover:text-mist"
        >
          <Cpu size={11} className="text-mist-ghost" />
          <span className="flex-1">
            {enabledModels > 0
              ? `${enabledModels} model${enabledModels === 1 ? '' : 's'} enabled`
              : acpProfiles.length > 0
                ? `${acpProfiles.length} ACP agent${acpProfiles.length === 1 ? '' : 's'} ready`
                : 'No model enabled'}
          </span>
          <Settings2 size={10} className="text-mist-ghost" />
        </button>
        <button
          onClick={() => void openWorkspace()}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[9.5px] text-mist-faint transition-colors hover:bg-ink-800 hover:text-mist"
          title={workspace || 'Open a workspace'}
        >
          <FolderGit2 size={11} className="text-mist-ghost" />
          <span className="min-w-0 flex-1 truncate">
            {workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : 'No workspace'}
          </span>
          <FolderOpen size={10} className="text-mist-ghost" />
        </button>
      </div>
    </aside>
  );
}
