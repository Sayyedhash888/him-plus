import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  Globe,
  History,
  Maximize2,
  MessageSquare,
  PencilLine,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { AgentSession, ChatEntry, ToolCallState } from '../../types';
import {
  cn,
  formatTokens,
  timeAgo,
  truncate,
} from '../../lib/utils';
import { useAgentUiStore } from '../../store/agentUi';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { useSessionStore } from '../../store/sessions';
import { useClickOutside } from '../../lib/hooks';
import {
  applyAgentCode,
  createAgent,
  openWorkspace,
  switchMode,
} from '../../lib/actions';
import { AgentComposer, type ComposerSeed } from '../agent/AgentComposer';
import { ApprovalCard } from '../agent/ChatTimeline';
import { MediaGallery } from '../agent/MediaGallery';
import { Button, IconButton, MarkdownView, Spinner, StatusDot } from '../ui';
import { BrandMark } from '../Brand';

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

function statusTone(status: AgentSession['status']): 'accent' | 'mint' | 'sand' | 'coral' | 'muted' {
  if (status === 'running') return 'accent';
  if (status === 'waiting') return 'sand';
  if (status === 'completed') return 'mint';
  if (status === 'error') return 'coral';
  return 'muted';
}

function CompactTools({
  session,
  calls,
}: {
  session: AgentSession;
  calls: ToolCallState[];
}) {
  const openChange = useAgentUiStore((state) => state.openChange);
  const setTab = useAgentUiStore((state) => state.setTab);
  const setInspectorOpen = useAgentUiStore((state) => state.setInspectorOpen);

  const act = (call: ToolCallState) => {
    if ((call.name === 'write_file' || call.name === 'apply_patch') && call.meta?.path) {
      switchMode('agent');
      useSessionStore.getState().setActive(session.id);
      openChange(session.id, call.meta.path);
      return;
    }
    if (call.name === 'run_terminal_command') {
      switchMode('agent');
      useSessionStore.getState().setActive(session.id);
      setTab('terminal');
      setInspectorOpen(true);
    }
  };

  return (
    <div className="mt-1.5 space-y-0.5">
      {calls.map((call) => {
        const Icon = toolIcons[call.name as keyof typeof toolIcons] || Wrench;
        const actionable =
          (call.name === 'write_file' || call.name === 'apply_patch' || call.name === 'run_terminal_command') &&
          call.status === 'done';
        return (
          <div
            key={call.id}
            onClick={() => actionable && act(call)}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded border border-line/70 bg-ink-900/40 px-1.5',
              actionable && 'cursor-pointer hover:border-line-strong hover:bg-ink-800/60',
            )}
            title={call.meta?.path || call.meta?.command || call.name}
          >
            <Icon size={9} className="shrink-0 text-mist-ghost" />
            <span className="shrink-0 font-mono text-[8px] text-mist-faint">{call.name}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[8.5px] text-mist-dim">
              {call.meta?.path || call.meta?.command || call.meta?.query || ''}
            </span>
            {call.status === 'running' && <Spinner size={8} />}
            {call.status === 'waiting' && <ShieldAlert size={8} className="text-sand" />}
            {call.status === 'done' && <Check size={8} className="text-mint" />}
            {call.status === 'error' && <AlertTriangle size={8} className="text-coral" />}
            {call.status === 'rejected' && <X size={8} className="text-mist-ghost" />}
            {actionable && <ArrowUpRight size={8} className="text-mist-ghost" />}
          </div>
        );
      })}
    </div>
  );
}

function CompactMessage({ message, session }: { message: ChatEntry; session: AgentSession }) {
  if (message.role === 'tool') return null;
  if (message.role === 'system') {
    if (!message.compactionNote) return null;
    return (
      <div className="rounded border border-line bg-ink-850/40 px-2.5 py-1.5 text-[8.5px] leading-relaxed text-mist-ghost">
        {truncate(message.content, 220)}
      </div>
    );
  }
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end">
        {message.media && message.media.length > 0 && (
          <MediaGallery media={message.media} compact className="mb-1 justify-end" />
        )}
        <div className="max-w-[90%] whitespace-pre-wrap break-word rounded-lg rounded-tr-sm border border-line bg-ink-750/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-mist-bright">
          {message.content}
        </div>
        <span className="mt-0.5 font-mono text-[7.5px] text-mist-ghost">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="relative mt-0.5 shrink-0">
        <BrandMark size={20} alt="" />
        {message.streaming && (
          <span className="absolute -right-0.5 -top-0.5 h-1 w-1 rounded-full bg-accent" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[9.5px] font-semibold text-mist">HIM Agent</span>
          <span className="font-mono text-[7.5px] text-mist-ghost">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {message.streaming && <Spinner size={8} />}
        </div>
        {message.reasoning && (
          <details className="group mb-1.5 rounded border border-line bg-ink-900/40">
            <summary className="flex items-center gap-1 px-1.5 py-1 text-[8px] text-mist-ghost">
              <Bot size={8} /> reasoning
              <ChevronDown
                size={8}
                className="ml-auto transition-transform group-open:rotate-180"
              />
            </summary>
            <pre className="thin-scrollbar max-h-[130px] overflow-auto border-t border-line/70 px-2 py-1 font-mono text-[8.5px] leading-relaxed text-mist-faint">
              {message.reasoning}
            </pre>
          </details>
        )}
        {message.content ? (
          <MarkdownView content={message.content} onApplyCode={applyAgentCode} className="compact" />
        ) : message.streaming ? (
          <div className="flex items-center gap-1.5 py-1 text-[9px] text-mist-faint">
            <Spinner size={9} /> Working…
          </div>
        ) : null}
        {message.streaming && message.content && (
          <span className="stream-caret inline-block h-2.5" />
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <CompactTools session={session} calls={message.toolCalls} />
        )}
        {message.toolCalls
          ?.filter((call) => call.status === 'waiting')
          .map((call) => (
            <ApprovalCard key={call.id} sessionId={session.id} call={call} />
          ))}
        {message.error && (
          <div className="mt-1.5 rounded border border-coral/20 bg-coral-deep/20 px-2 py-1.5 text-[9px] leading-relaxed text-coral-soft">
            {message.error}
          </div>
        )}
      </div>
    </div>
  );
}

function NoSession() {
  const workspace = useCoreStore((state) => state.workspace);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-accent/20 bg-ink-850 shadow-glow">
        <span className="mono-tight text-[17px] font-semibold text-accent">H+</span>
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
      </div>
      <div className="mt-3 text-[11.5px] font-semibold text-mist-bright">Synced agent chat</div>
      <p className="mt-1 max-w-[250px] text-[9px] leading-relaxed text-mist-faint">
        Spawn an agent to inspect your workspace and edit files. Changes, approvals and artifacts
        stay in sync with Mission Control.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        {workspace ? (
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            icon={<Plus size={11} />}
            onClick={async () => {
              setBusy(true);
              try {
                await createAgent();
              } finally {
                setBusy(false);
              }
            }}
          >
            Spawn agent
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={<FolderOpen size={11} />} onClick={() => void openWorkspace()}>
            Open a workspace
          </Button>
        )}
        <button
          onClick={() => switchMode('agent')}
          className="text-[8.5px] text-mist-ghost hover:text-mist"
        >
          Open Mission Control
        </button>
      </div>
      <div className="mt-5 flex items-center gap-1.5 font-mono text-[7.5px] text-mist-ghost">
        <kbd>@</kbd> context
        <kbd>/</kbd> commands
        <kbd>Shift+Tab</kbd> preset
      </div>
    </div>
  );
}

function SessionEmpty({ session, onSeed }: { session: AgentSession; onSeed(text: string): void }) {
  const seeds = [
    {
      icon: Search,
      label: 'Map the codebase',
      detail: 'Architecture, entry points and risks',
      prompt:
        'Map this codebase: architecture, entry points, key modules and risky areas. Use file references.',
    },
    {
      icon: AlertTriangle,
      label: 'Find a failure',
      detail: 'Diagnose and fix a test or build error',
      prompt:
        'Find the failing tests or build errors in this workspace, diagnose the root cause, then fix them safely.',
    },
    {
      icon: Sparkles,
      label: 'Implement a feature',
      detail: 'Inspect, edit and validate end-to-end',
      prompt:
        'Implement a feature in the current architecture. Start by inspecting the relevant code and proposing the smallest safe change.',
    },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-ink-850">
        <MessageSquare size={15} className="text-accent-dim" />
      </div>
      <div className="mt-3 text-[11px] font-semibold text-mist-bright">{session.title}</div>
      <p className="mt-1 max-w-[260px] text-[9px] leading-relaxed text-mist-faint">
        This chat is the same session as Mission Control. Ask a question, attach{' '}
        <span className="font-mono text-mist">@files</span>, or start a mission.
      </p>
      <div className="mt-4 w-full space-y-1">
        {seeds.map((seed) => {
          const Icon = seed.icon;
          return (
            <button
              key={seed.label}
              onClick={() => onSeed(seed.prompt)}
              className="flex w-full items-center gap-2 rounded-md border border-line bg-ink-850/45 px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-ink-800/70"
            >
              <Icon size={11} className="shrink-0 text-mist-faint" />
              <span className="min-w-0 flex-1">
                <span className="block text-[9.5px] font-medium text-mist">{seed.label}</span>
                <span className="block truncate text-[8px] text-mist-ghost">{seed.detail}</span>
              </span>
              <ArrowUpRight size={9} className="shrink-0 text-mist-ghost" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AiSidebar({ active, width = 344 }: { active: boolean; width?: number }) {
  const sessions = useSessionStore((state) => state.sessions);
  const activeId = useSessionStore((state) => state.activeId);
  const setActive = useSessionStore((state) => state.setActive);
  const toggleAiPanel = useEditorStore((state) => state.toggleAiPanel);
  const session = sessions.find((item) => item.id === activeId) || null;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastSession = useRef<string | null>(null);
  useClickOutside(selectorRef, () => setSelectorOpen(false), selectorOpen);

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActive(sessions[0].id);
  }, [activeId, sessions, setActive]);

  const visibleMessages = (session?.messages || []).filter(
    (message) =>
      message.role === 'user' ||
      message.role === 'assistant' ||
      (message.role === 'system' && message.compactionNote),
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (lastSession.current !== (session?.id || null)) {
      lastSession.current = session?.id || null;
      stickRef.current = true;
      element.scrollTop = element.scrollHeight;
      return;
    }
    if (stickRef.current) element.scrollTop = element.scrollHeight;
  }, [session?.messages, session?.status, session?.id]);

  const pendingChanges = session
    ? session.changes.filter((change) => change.status === 'pending').length
    : 0;

  const openAgentMode = () => {
    if (session) useSessionStore.getState().setActive(session.id);
    useAgentUiStore.getState().setInspectorOpen(true);
    switchMode('agent');
  };

  return (
    <aside
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col border-l border-line bg-ink-850/35',
        active ? '' : '',
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-ink-900/40 px-2">
        <div ref={selectorRef} className="relative min-w-0 flex-1">
          <button
            onClick={() => setSelectorOpen((value) => !value)}
            className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left transition-colors hover:bg-ink-800"
          >
            <Sparkles size={11} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-mist">
              {session ? session.title : 'Agent chat'}
            </span>
            {session && <StatusDot tone={statusTone(session.status)} pulse={session.status === 'running'} />}
            <ChevronDown
              size={9}
              className={cn('shrink-0 text-mist-ghost transition-transform', selectorOpen && 'rotate-180')}
            />
          </button>
          {selectorOpen && (
            <>
              <div
                className="fixed inset-0 z-[70]"
                onMouseDown={() => setSelectorOpen(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-full z-[80] mt-1 w-[270px] animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
                <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
                  <span className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-mist-faint">
                    Sessions
                  </span>
                  <button
                    onClick={async () => {
                      setSelectorOpen(false);
                      await createAgent();
                    }}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[8.5px] text-mist-faint hover:bg-ink-750 hover:text-mist"
                  >
                    <Plus size={9} /> New
                  </button>
                </div>
                <div className="max-h-[240px] overflow-y-auto p-1">
                  {sessions.length === 0 && (
                    <div className="px-2 py-3 text-[9px] text-mist-ghost">No sessions yet.</div>
                  )}
                  {sessions.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActive(item.id);
                        setSelectorOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                        item.id === activeId ? 'bg-ink-750' : 'hover:bg-ink-750/60',
                      )}
                    >
                      <StatusDot tone={statusTone(item.status)} pulse={item.status === 'running'} />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-mist">
                        {item.title}
                      </span>
                      <span className="font-mono text-[8px] text-mist-ghost">
                        {formatTokens(item.tokens.input + item.tokens.output)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <IconButton
          label="New agent"
          size="xs"
          onClick={() => void createAgent()}
        >
          <Plus size={12} />
        </IconButton>
        <IconButton
          label="Open in Agent Mode"
          size="xs"
          onClick={openAgentMode}
        >
          <Maximize2 size={11} />
        </IconButton>
        <IconButton label="Collapse AI panel" size="xs" onClick={toggleAiPanel}>
          <X size={12} />
        </IconButton>
      </div>

      {session && pendingChanges > 0 && (
        <button
          onClick={() => {
            useAgentUiStore.getState().setTab('changes');
            useAgentUiStore.getState().setInspectorOpen(true);
            openAgentMode();
          }}
          className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line bg-sand/[0.035] px-3 text-left text-[8.5px] text-sand-soft transition-colors hover:bg-sand/[0.06]"
        >
          <AlertTriangle size={9} />
          {pendingChanges} file change{pendingChanges === 1 ? '' : 's'} pending review
          <span className="ml-auto text-accent-soft">Review →</span>
        </button>
      )}

      {!session ? (
        <NoSession />
      ) : visibleMessages.length === 0 ? (
        <SessionEmpty session={session} onSeed={(text) => setSeed({ text, nonce: Date.now() + Math.random() })} />
      ) : (
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            stickRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
          className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {visibleMessages.map((message) => (
            <CompactMessage key={message.id} message={message} session={session} />
          ))}
          <div className="flex items-center justify-center gap-1.5 pt-1 text-[7.5px] text-mist-ghost">
            <Bot size={8} />
            {session.status === 'running'
              ? 'Agent is working · synced with Mission Control'
              : session.status === 'waiting'
                ? 'Waiting for approval'
                : session.status === 'completed'
                  ? `Updated ${timeAgo(session.updatedAt)}`
                  : session.status}
          </div>
        </div>
      )}

      {session && (
        <AgentComposer
          session={session}
          seed={seed}
          compact
        />
      )}
    </aside>
  );
}
