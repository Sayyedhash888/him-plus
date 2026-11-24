import {
  AlertTriangle,
  CircleDot,
  GitBranch,
  Hash,
} from 'lucide-react';
import { cn, formatCost, formatTokens } from '../lib/utils';
import { useCoreStore } from '../store/core';
import { useEditorStore, activeTabFrom } from '../store/editor';
import { useSessionStore } from '../store/sessions';
import { useWorkspaceName } from '../store/core';
import { useAgentUiStore } from '../store/agentUi';
import { effectiveModelFor } from '../lib/agent/runtime';
import { resolveCapabilities } from '../lib/modelCaps';
import { McpPanel } from './McpPanel';
import { LspStatusChip } from './LspStatusChip';
import { ModelMenu } from './ModelMenu';
import { AcpModelMenu } from './agent/AcpModelMenu';

export function StatusBar() {
  const mode = useCoreStore((state) => state.mode);
  const git = useCoreStore((state) => state.git);
  const setMode = useCoreStore((state) => state.setMode);
  const workspaceName = useWorkspaceName();
  const activePath = useEditorStore((state) => state.activePath);
  const tabs = useEditorStore((state) => state.tabs);
  const cursor = useEditorStore((state) => state.cursor);
  const problems = useEditorStore((state) => state.problems);
  const setBottomTab = useEditorStore((state) => state.setBottomTab);
  const bottomOpen = useEditorStore((state) => state.bottomOpen);
  const activeSession = useSessionStore((state) =>
    state.sessions.find((session) => session.id === state.activeId) || null,
  );
  const sessionCount = useSessionStore((state) => state.sessions.length);
  const tab = activeTabFrom({ tabs, activePath });
  const errorCount = problems.filter((problem) => problem.severity === 1).length;
  const activeChanges = activeSession
    ? activeSession.changes.filter((change) => change.status === 'pending').length
    : 0;
  const tokens = activeSession ? activeSession.tokens.input + activeSession.tokens.output : 0;
  const cost = formatCost(activeSession?.tokens.cost);
  const activeModel = activeSession ? effectiveModelFor(activeSession) : null;
  const contextWindow = activeModel
    ? resolveCapabilities(activeModel.model.id, activeModel.model.capabilities).contextWindow
    : 0;
  const lastUsage = activeSession
    ? [...activeSession.messages].reverse().find((message) => message.role === 'assistant' && message.usage)
        ?.usage
    : undefined;
  const contextUsed = lastUsage?.totalTokens || lastUsage?.promptTokens || 0;
  const contextPercent =
    contextWindow > 0 && contextUsed > 0
      ? Math.min(100, Math.max(1, Math.round((contextUsed / contextWindow) * 100)))
      : 0;

  return (
    <footer className="z-40 flex h-[26px] shrink-0 select-none items-center border-t border-line bg-ink-950 text-[10px] text-mist-faint">
      <button
        onClick={() => setMode(mode === 'agent' ? 'ide' : 'agent')}
        className="flex h-full items-center gap-1.5 px-2.5 transition-colors hover:bg-ink-800"
        title="Switch mode (Ctrl+Shift+M)"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            mode === 'agent'
              ? 'bg-accent glow-accent'
              : 'bg-mint glow-mint',
          )}
        />
        <span className="font-medium uppercase tracking-[0.1em] text-mist-dim">
          {mode === 'agent' ? 'Agent' : 'IDE'}
        </span>
      </button>
      <div className="h-3 w-px bg-line" />
      <div
        className="flex h-full max-w-[220px] items-center gap-1.5 px-2.5"
        title={git?.isRepo ? `Git branch: ${git.branch}` : 'Not a git repository'}
      >
        <GitBranch size={10} className="shrink-0 text-mist-ghost" />
        <span className="truncate font-mono text-[9.5px] text-mist-faint">
          {workspaceName === 'No workspace'
            ? 'no folder'
            : git?.isRepo
              ? git.branch || 'detached'
              : 'no repo'}
        </span>
        {git?.isRepo && git.files.length > 0 && (
          <span className="font-mono text-[9px] text-sand">{git.files.length}∆</span>
        )}
      </div>
      {mode === 'agent' && activeSession && (
        <>
          <div className="h-3 w-px bg-line" />
          <div className="flex h-full items-center gap-1.5 px-2.5">
            <CircleDot
              size={9}
              className={cn(
                activeSession.status === 'running' && 'animate-pulse text-accent',
                activeSession.status === 'waiting' && 'text-sand',
                activeSession.status === 'error' && 'text-coral',
                activeSession.status === 'completed' && 'text-mint',
              )}
            />
            <span className="text-mist-faint">
              {activeSession.title} · {activeSession.status}
            </span>
          </div>
          {activeChanges > 0 && (
            <button
              onClick={() => {
                useAgentUiStore.getState().setTab('changes');
                useAgentUiStore.getState().setInspectorOpen(true);
              }}
              className="flex h-full items-center gap-1 px-2 text-sand transition-colors hover:bg-ink-800"
            >
              {activeChanges} change{activeChanges === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
      {mode === 'ide' && errorCount > 0 && (
        <button
          onClick={() => setBottomTab('problems')}
          className={cn(
            'flex h-full items-center gap-1 px-2 transition-colors hover:bg-ink-800',
            bottomOpen ? 'text-mist' : 'text-mist-faint',
          )}
        >
          <AlertTriangle size={9} className="text-sand" />
          <span className="font-mono">{errorCount}</span>
        </button>
      )}
      <div className="flex-1" />
      {sessionCount > 0 && mode === 'agent' && (
        <div className="mr-1 hidden items-center gap-1 px-2 text-mist-ghost lg:flex">
          <span>{sessionCount} agent{sessionCount === 1 ? '' : 's'}</span>
        </div>
      )}
      {mode === 'ide' && tab && (
        <div className="hidden h-full items-center px-2 font-mono text-[9.5px] md:flex">
          Ln {cursor.line}, Col {cursor.column}
        </div>
      )}
      {mode === 'ide' && (
        <>
          <div className="hidden h-full items-center px-2 text-[9.5px] md:flex">Spaces: 2</div>
          <div className="hidden h-full items-center px-2 text-[9.5px] lg:flex">UTF-8</div>
        </>
      )}
      <LspStatusChip />
      <McpPanel />
      {activeSession?.backend === 'acp' ? (
        <div className="flex h-full items-center border-l border-line px-1">
          <AcpModelMenu session={activeSession} compact />
        </div>
      ) : (
        <div className="flex h-full items-center border-l border-line px-0.5">
          <ModelMenu variant="status" />
        </div>
      )}
      <div
        className="flex h-full items-center gap-1 border-l border-line px-2 font-mono text-[9.5px]"
        title={
          activeSession
            ? `Input ${activeSession.tokens.input.toLocaleString()} · Output ${activeSession.tokens.output.toLocaleString()}${activeSession.tokens.estimated ? ' · estimated' : ''}`
            : 'No agent session selected'
        }
      >
        <Hash size={9} className="text-mist-ghost" />
        <span>{formatTokens(tokens)}</span>
        <span className="text-mist-ghost">tok</span>
        {activeSession?.tokens.estimated && <span className="text-mist-ghost">~</span>}
        {cost && (
          <>
            <span className="mx-0.5 text-line">|</span>
            <span className="text-mint/80">{cost}</span>
          </>
        )}
      </div>
      {contextPercent > 0 && (
        <div
          className={cn(
            'hidden h-full items-center gap-1 border-l border-line px-2 font-mono text-[9.5px] sm:flex',
            contextPercent >= 85
              ? 'text-coral-soft'
              : contextPercent >= 70
                ? 'text-sand'
                : 'text-mist-faint',
          )}
          title={`Context used: ${formatTokens(contextUsed)} of ~${formatTokens(contextWindow)} tokens (estimated; compact with /compact)`}
        >
          <span className="text-mist-ghost">ctx</span>
          <span>{contextPercent}%</span>
        </div>
      )}
    </footer>
  );
}
