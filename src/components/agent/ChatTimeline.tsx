import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Bookmark,
  Bot,
  Brain,
  Bug,
  Check,
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranch,
  Map,
  Plus,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { AgentSession, ChatEntry, ToolCallState } from '../../types';
import { cn, formatTokens, timeAgo, truncate } from '../../lib/utils';
import { isDestructiveCommand } from '../../lib/agent/tools';
import { permissionMeta } from '../../lib/agent/prompts';
import { useAgentUiStore } from '../../store/agentUi';
import { useConfigStore, providerModelOptions } from '../../store/config';
import { useCoreStore } from '../../store/core';
import { useSessionStore } from '../../store/sessions';
import { createAgent, openWorkspace, saveMessageAsArtifact } from '../../lib/actions';
import { respondApproval } from '../../lib/agent/runtime';
import { Button, MarkdownView, Spinner } from '../ui';
import { BrandMark } from '../Brand';
import { ToolCard } from './ToolCard';
import { MediaGallery } from './MediaGallery';

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming?: boolean }) {
  if (!reasoning.trim()) return null;
  return (
    <details className="group mb-2.5 overflow-hidden rounded-md border border-line bg-ink-850/30">
      <summary className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9.5px] text-mist-faint transition-colors hover:bg-ink-800/50 hover:text-mist">
        <Brain size={10} className="text-mist-ghost" />
        <span>Reasoning</span>
        <span className="font-mono text-[8.5px] text-mist-ghost">
          {formatTokens(reasoning.length)} chars
        </span>
        {streaming && <Spinner size={9} className="ml-1 text-accent" />}
        <ChevronRight
          size={9}
          className="ml-auto text-mist-ghost transition-transform group-open:rotate-90"
        />
      </summary>
      <pre className="thin-scrollbar max-h-[220px] overflow-auto border-t border-line/70 px-3 py-2 font-mono text-[10px] leading-[1.7] text-mist-faint">
        {reasoning}
      </pre>
    </details>
  );
}

export function ApprovalCard({
  sessionId,
  call,
}: {
  sessionId: string;
  call: ToolCallState;
}) {
  const backend = useSessionStore(
    (state) => state.sessions.find((session) => session.id === sessionId)?.backend,
  );
  const [pendingChoice, setPendingChoice] = useState<'allow' | 'reject' | null>(null);
  // ACP agents bring their own permission requests, handled by the ACP client
  // gate (read-only operations are auto-allowed by the HIM+ permission mode).
  // Do not render a second, native approval card for them.
  if (backend === 'acp') return null;
  const command =
    call.name === 'run_terminal_command'
      ? String(call.parsedArgs.command || call.meta?.command || '')
      : '';
  const commandCwd =
    call.name === 'run_terminal_command'
      ? String(call.parsedArgs.cwd || call.meta?.path || '.')
      : '';
  const destructive =
    call.name === 'run_terminal_command' && isDestructiveCommand(command);
  const target = call.meta?.path || call.meta?.command || call.meta?.query || '';
  const preview =
    call.meta?.preview ||
    (call.name === 'run_terminal_command' ? command : target);
  const choose = (allow: boolean, always = false) => {
    setPendingChoice(allow ? 'allow' : 'reject');
    const handled = respondApproval(sessionId, allow, always);
    if (!handled) setPendingChoice(null);
  };

  return (
    <div
      className={cn(
        'mt-2 overflow-hidden rounded-lg border',
        destructive
          ? 'border-coral/30 bg-coral/[0.035]'
          : 'border-sand/25 bg-sand/[0.035]',
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
            destructive
              ? 'border-coral/30 bg-coral-deep/40 text-coral'
              : 'border-sand/25 bg-sand-deep/30 text-sand',
          )}
        >
          <ShieldAlert size={12} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-mist-bright">
              {destructive ? 'Destructive command approval' : 'Approval required'}
            </span>
            <span className="rounded border border-line px-1 py-px font-mono text-[8px] uppercase tracking-wide text-mist-ghost">
              {call.name}
            </span>
          </div>
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-mist-faint">
            {destructive
              ? 'This command may remove or overwrite data. It is paused even in Auto mode.'
              : 'Review-driven mode pauses file writes and shell commands before execution.'}
          </p>
        </div>
      </div>
      {call.name === 'run_terminal_command' && (
        <div className="mx-3 mb-1 flex items-center gap-2 font-mono text-[8px] text-mist-ghost">
          <span className="uppercase tracking-[0.1em]">Full command</span>
          <span className="text-mist-ghost/70">·</span>
          <span className="min-w-0 truncate">cwd: {commandCwd}</span>
          <span className="ml-auto text-sand/70">runs with your user permissions</span>
        </div>
      )}
      <pre className="thin-scrollbar mx-3 mb-2 max-h-[190px] overflow-auto whitespace-pre-wrap break-words rounded border border-line/70 bg-ink-950/70 px-2.5 py-2 font-mono text-[10px] leading-[1.65] text-mist-dim">
        {call.name === 'run_terminal_command'
          ? command
            ? `$ ${command}`
            : '(empty command)'
          : preview || '(no preview)'}
      </pre>
      {destructive && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded border border-coral/20 bg-coral-deep/20 px-2 py-1.5 text-[9px] leading-relaxed text-coral-soft">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          Inspect the command carefully. Allow only if you intend this exact operation.
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line/70 bg-ink-900/40 px-3 py-2">
        <span className="font-mono text-[8.5px] text-mist-ghost">
          {call.meta?.path ? truncate(call.meta.path, 46) : 'one action, one approval'}
        </span>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => choose(false)}
            disabled={pendingChoice !== null}
          >
            Reject
          </Button>
          {!destructive && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => choose(true, true)}
              disabled={pendingChoice !== null}
              title="Allow this tool for the rest of the session (destructive commands still ask)"
            >
              {call.name === 'run_terminal_command' ? 'Always allow commands' : 'Always allow'}
            </Button>
          )}
          <Button
            size="xs"
            variant={destructive ? 'danger' : 'primary'}
            onClick={() => choose(true)}
            loading={pendingChoice === 'allow'}
            disabled={pendingChoice !== null}
          >
            Allow once
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageActions({ message, sessionId }: { message: ChatEntry; sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100">
      {message.content.trim() && (
        <>
          <button
            onClick={() => void copy()}
            className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
            aria-label="Copy message"
            title="Copy message"
          >
            {copied ? <Check size={10} className="text-mint" /> : <Copy size={10} />}
          </button>
          <button
            onClick={() => saveMessageAsArtifact(sessionId, message.id)}
            className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
            aria-label="Save message to artifacts"
            title="Save to artifacts"
          >
            <Bookmark size={10} />
          </button>
        </>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  session,
}: {
  message: ChatEntry;
  session: AgentSession;
}) {
  const openChange = useAgentUiStore((state) => state.openChange);
  const setTab = useAgentUiStore((state) => state.setTab);
  const setInspectorOpen = useAgentUiStore((state) => state.setInspectorOpen);
  const viewDiff = (path: string) => {
    openChange(session.id, path);
  };
  const viewTerminal = () => {
    setTab('terminal');
    setInspectorOpen(true);
  };
  return (
    <div className="group/message flex gap-3 animate-fade-in">
      <div className="relative mt-0.5">
        <BrandMark size={24} alt="" />
        {message.streaming && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent glow-accent" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex h-5 items-center gap-2">
          <span className="text-[10.5px] font-semibold text-mist">HIM Agent</span>
          <span className="font-mono text-[8.5px] text-mist-ghost">
            {timeLabel(message.createdAt)}
          </span>
          {message.streaming && (
            <span className="flex items-center gap-1 text-[8.5px] text-accent/80">
              <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent" />
              working
            </span>
          )}
          {message.usage && !message.streaming && (
            <span className="hidden font-mono text-[8.5px] text-mist-ghost md:inline">
              ↑{formatTokens(message.usage.promptTokens || 0)} ↓
              {formatTokens(message.usage.completionTokens || 0)}
            </span>
          )}
          <div className="ml-auto">
            <MessageActions message={message} sessionId={session.id} />
          </div>
        </div>

        {message.reasoning && (
          <ReasoningBlock reasoning={message.reasoning} streaming={message.streaming} />
        )}

        {message.content ? (
          <div className="relative">
            <MarkdownView content={message.content} />
            {message.streaming && <span className="stream-caret inline-block h-3" />}
          </div>
        ) : message.streaming ? (
          <div className="flex items-center gap-2 py-1 text-[10.5px] text-mist-faint">
            <Spinner size={11} className="text-accent" />
            <span className="shimmer-text">Thinking through the next move</span>
          </div>
        ) : null}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {message.toolCalls.map((call) => (
              <ToolCard
                key={call.id}
                call={call}
                onViewDiff={viewDiff}
                onViewTerminal={viewTerminal}
              />
            ))}
            {message.toolCalls
              .filter((call) => call.status === 'waiting')
              .map((call) => (
                <ApprovalCard key={`approve-${call.id}`} sessionId={session.id} call={call} />
              ))}
          </div>
        )}

        {message.error && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-coral/25 bg-coral-deep/20 px-2.5 py-2 text-[10px] leading-relaxed text-coral-soft">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="break-word">{message.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatEntry }) {
  return (
    <div className="flex flex-col items-end animate-fade-in">
      <div className="mb-1 flex items-center gap-1.5 text-[8.5px] text-mist-ghost">
        <span>You</span>
        <span>·</span>
        <span className="font-mono">{timeLabel(message.createdAt)}</span>
      </div>
      {message.media && message.media.length > 0 && (
        <MediaGallery media={message.media} className="mb-1 max-w-[88%] justify-end" />
      )}
      <div className="max-w-[88%] whitespace-pre-wrap break-word rounded-lg rounded-tr-sm border border-line bg-ink-750/80 px-3.5 py-2.5 text-[12px] leading-relaxed text-mist-bright shadow-inset">
        {message.content}
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-1 flex max-w-[88%] flex-wrap justify-end gap-1">
          {message.attachments.map((attachment) => (
            <span
              key={attachment}
              className="inline-flex max-w-[220px] items-center gap-1 rounded border border-line bg-ink-850/70 px-1.5 py-0.5 font-mono text-[8.5px] text-mist-faint"
            >
              <span className="text-accent-dim">@</span>
              <span className="truncate">{attachment}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactionMessage({ message }: { message: ChatEntry }) {
  return (
    <details className="group mx-auto w-full max-w-[560px] rounded-md border border-line bg-ink-850/40">
      <summary className="flex items-center gap-2 px-3 py-2 text-[9.5px] text-mist-faint">
        <Archive size={10} className="text-mist-ghost" />
        Conversation compacted locally
        <ChevronRight
          size={9}
          className="ml-auto text-mist-ghost transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="border-t border-line px-3 py-2">
        <pre className="whitespace-pre-wrap font-mono text-[9.5px] leading-relaxed text-mist-faint">
          {message.content}
        </pre>
      </div>
    </details>
  );
}

function Hero({
  session,
  onSeedPrompt,
}: {
  session: AgentSession | null;
  onSeedPrompt(text: string): void;
}) {
  const workspace = useCoreStore((state) => state.workspace);
  const git = useCoreStore((state) => state.git);
  const config = useConfigStore((state) => state.config);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const modelCount = providerModelOptions(config).length;
  const [creating, setCreating] = useState(false);
  const seeds = [
    {
      icon: Map,
      tone: 'text-accent border-accent/20 bg-accent/[0.05]',
      title: 'Map this codebase',
      description: 'Architecture, entry points, and risky seams.',
      prompt:
        'Map this codebase: architecture, entry points, key modules, data flow, and risky areas. Produce a concise implementation map with file references.',
    },
    {
      icon: Bug,
      tone: 'text-coral border-coral/20 bg-coral/[0.05]',
      title: 'Diagnose a failure',
      description: 'Find the root cause, then fix it with evidence.',
      prompt:
        'Find the failing tests or build errors in this workspace. Diagnose the root cause with evidence, then implement the smallest safe fix and validate it.',
    },
    {
      icon: Sparkles,
      tone: 'text-mint border-mint/20 bg-mint/[0.05]',
      title: 'Ship a feature',
      description: 'Inspect, plan, edit, and validate end-to-end.',
      prompt:
        'Implement a feature in this workspace. First inspect the relevant code, then make the smallest safe set of changes, and validate the result. Start by proposing the feature scaffold in the current architecture.',
    },
  ];

  const useSeed = async (prompt: string) => {
    if (session) {
      onSeedPrompt(prompt);
      return;
    }
    if (!workspace) return;
    setCreating(true);
    try {
      const created = await createAgent();
      if (created) onSeedPrompt(prompt);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-y-auto">
      <div className="hairline-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto flex w-full max-w-[660px] flex-col justify-center px-6 py-10">
        <div className="inline-flex items-center gap-2 self-start rounded border border-line bg-ink-850/70 px-2 py-1">
          <span className="h-1 w-1 rounded-full bg-accent glow-accent" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-mist-faint">
            HIM+ / Mission Control
          </span>
        </div>
        <h1 className="mt-4 text-balance text-[31px] font-semibold leading-[1.06] tracking-[-0.045em] text-mist-bright">
          Direct the work.
          <br />
          <span className="text-mist-faint">Review every line.</span>
        </h1>
        <p className="mt-3 max-w-[470px] text-balance text-[11.5px] leading-relaxed text-mist-faint">
          Spawn focused agents, hand them real tools, and keep every edit behind a reviewable
          diff. One workspace, parallel missions.
        </p>

        {!workspace ? (
          <div className="mt-6">
            <Button
              variant="primary"
              size="md"
              icon={<FolderOpen size={13} />}
              onClick={() => void openWorkspace()}
            >
              Open a workspace
            </Button>
            <p className="mt-2 text-[9.5px] text-mist-ghost">
              Agent tools are scoped to the folder you open.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-1.5">
            {seeds.map((seed) => {
              const Icon = seed.icon;
              return (
                <button
                  key={seed.title}
                  onClick={() => void useSeed(seed.prompt)}
                  disabled={creating}
                  className="group flex w-full items-center gap-3 rounded-md border border-line bg-ink-850/45 px-3 py-2.5 text-left transition-all duration-100 hover:border-line-strong hover:bg-ink-800/70 disabled:opacity-50"
                >
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                      seed.tone,
                    )}
                  >
                    <Icon size={13} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-mist-bright">{seed.title}</div>
                    <div className="mt-0.5 text-[9.5px] leading-relaxed text-mist-faint">
                      {seed.description}
                    </div>
                  </div>
                  {creating && !session ? (
                    <Spinner size={11} />
                  ) : (
                    <ArrowUpRight
                      size={12}
                      className="shrink-0 text-mist-ghost transition-colors group-hover:text-accent"
                    />
                  )}
                </button>
              );
            })}
            {!session && (
              <button
                onClick={async () => {
                  setCreating(true);
                  try {
                    await createAgent();
                  } finally {
                    setCreating(false);
                  }
                }}
                disabled={creating}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/[0.07] px-2.5 py-1.5 text-[10px] font-medium text-accent-soft transition-colors hover:bg-accent/10 disabled:opacity-50"
              >
                <Plus size={11} />
                {creating ? 'Spawning agent…' : 'Spawn agent'}
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line/70 pt-3 font-mono text-[8.5px] text-mist-ghost">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                'h-1 w-1 rounded-full',
                modelCount > 0 ? 'bg-mint' : 'bg-sand',
              )}
            />
            {modelCount > 0 ? `${modelCount} models online` : 'No model enabled'}
          </span>
          {workspace && (
            <span className="max-w-[180px] truncate">
              {workspace.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          )}
          {git?.isRepo && git.branch && (
            <span className="flex items-center gap-1">
              <GitBranch size={8} /> {git.branch}
            </span>
          )}
          {modelCount === 0 && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-accent-soft hover:text-accent"
            >
              Connect a provider →
            </button>
          )}
          <span className="ml-auto hidden items-center gap-1 text-mist-ghost md:flex">
            <kbd>@</kbd> context
            <span className="mx-0.5">·</span>
            <kbd>/</kbd> commands
          </span>
        </div>

        {session && session.messages.length === 0 && (
          <div className="mt-4 flex items-center gap-1.5 text-[9px] text-mist-ghost">
            <ShieldAlert size={9} />
            {permissionMeta[session.permission].label} is active · Shift+Tab to switch presets
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatTimeline({
  session,
  onSeedPrompt,
}: {
  session: AgentSession | null;
  onSeedPrompt(text: string): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastSession = useRef<string | null>(null);
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
    if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [session?.messages, session?.status, session?.id]);

  if (!session || visibleMessages.length === 0) {
    return <Hero session={session} onSeedPrompt={onSeedPrompt} />;
  }

  return (
    <div
      ref={scrollRef}
      className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;
        stickRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 100;
      }}
    >
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-5 py-5">
        {visibleMessages.map((message) => {
          if (message.role === 'user') return <UserMessage key={message.id} message={message} />;
          if (message.role === 'system' && message.compactionNote) {
            return <CompactionMessage key={message.id} message={message} />;
          }
          if (message.role === 'assistant') {
            return <AssistantMessage key={message.id} message={message} session={session} />;
          }
          return null;
        })}
        <div className="flex items-center justify-center gap-2 pt-1 text-[8.5px] text-mist-ghost">
          <Bot size={9} />
          <span>
            {session.status === 'running'
              ? 'Agent is working'
              : session.status === 'waiting'
                ? 'Agent is waiting for approval'
                : session.status === 'error'
                  ? 'Last turn ended with an error'
                  : session.status === 'completed'
                    ? `Turn finished · ${timeAgo(session.updatedAt)}`
                    : session.status === 'stopped'
                      ? 'Agent stopped'
                      : 'Agent ready'}
          </span>
        </div>
      </div>
    </div>
  );
}
