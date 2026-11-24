import { useRef, useState, useEffect } from 'react';
import {
  Bot,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  FolderGit2,
  GitBranch,
  Minus,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import { useCoreStore } from '../store/core';
import { useSessionStore } from '../store/sessions';
import { useConfigStore } from '../store/config';
import { useClickOutside } from '../lib/hooks';
import { cn, basename } from '../lib/utils';
import { him } from '../lib/bridge';
import { toast } from '../store/toast';
import { openWorkspace, switchMode, toggleMode } from '../lib/actions';
import { ModelMenu } from './ModelMenu';
import { AcpModelMenu } from './agent/AcpModelMenu';
import { ThemeMenu } from './ThemeMenu';
import { IconButton, Kbd, StatusDot, Tooltip } from './ui';
import { BrandLockup } from './Brand';

export function TopBar() {
  const mode = useCoreStore((state) => state.mode);
  const workspace = useCoreStore((state) => state.workspace);
  const git = useCoreStore((state) => state.git);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);
  const runningAgents = useSessionStore(
    (state) => state.sessions.filter((session) => session.status === 'running').length,
  );
  const waitingAgents = useSessionStore(
    (state) => state.sessions.filter((session) => session.status === 'waiting').length,
  );
  const activeSession = useSessionStore(
    (state) => state.sessions.find((session) => session.id === state.activeId) || null,
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useClickOutside(workspaceRef, () => setWorkspaceOpen(false), workspaceOpen);

  useEffect(() => {
    let active = true;
    void him.window.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    const unsubscribe = him.window.onMaximizedChange((value) => setMaximized(value));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const toggleWindow = () => him.window.maximize();

  return (
    <header
      className="app-drag relative z-50 grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-ink-900/95 px-2 backdrop-blur"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input, a')) return;
        toggleWindow();
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className="flex select-none items-center pl-1"
          title="HIM+ — Integrated development environment"
        >
          <BrandLockup size={26} />
        </div>
        <div className="h-4 w-px bg-line" />
        <div ref={workspaceRef} className="relative app-no-drag">
          <button
            onClick={() => setWorkspaceOpen((value) => !value)}
            className={cn(
              'flex h-7 max-w-[245px] min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-ink-800',
              workspaceOpen && 'bg-ink-800',
            )}
            title={workspace || 'Open a workspace'}
          >
            <FolderGit2 size={12} className="shrink-0 text-mist-faint" />
            <span className="min-w-0 truncate text-[11px] text-mist">
              {workspace ? basename(workspace) : 'Open workspace'}
            </span>
            {git?.branch && (
              <span className="hidden min-w-0 items-center gap-1 rounded border border-line bg-ink-850/80 px-1.5 py-px text-[9px] text-mist-faint lg:flex">
                <GitBranch size={8} />
                <span className="max-w-[74px] truncate font-mono">{git.branch}</span>
              </span>
            )}
            <ChevronDown
              size={10}
              className={cn('shrink-0 text-mist-ghost transition-transform', workspaceOpen && 'rotate-180')}
            />
          </button>
          {workspaceOpen && (
            <>
              <div
                className="fixed inset-0 z-[70]"
                onMouseDown={() => setWorkspaceOpen(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-full z-[80] mt-1.5 w-[310px] animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 shadow-panel">
                <div className="border-b border-line p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <FolderGit2 size={11} className="text-accent" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-dim">
                      Workspace
                    </span>
                  </div>
                  <div className="break-word mt-1 font-mono text-[10px] leading-relaxed text-mist">
                    {workspace || 'No folder opened'}
                  </div>
                  {git?.isRepo && (
                    <div className="mt-2 flex items-center gap-2 text-[9.5px] text-mist-faint">
                      <span className="inline-flex items-center gap-1">
                        <GitBranch size={9} /> {git.branch || 'detached'}
                      </span>
                      <span>{git.files.length} changed</span>
                      {(git.ahead > 0 || git.behind > 0) && (
                        <span>
                          {git.ahead > 0 ? `${git.ahead} ahead` : ''}
                          {git.ahead > 0 && git.behind > 0 ? ' · ' : ''}
                          {git.behind > 0 ? `${git.behind} behind` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="p-1.5">
                  <button
                    onClick={() => {
                      setWorkspaceOpen(false);
                      void openWorkspace();
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-mist transition-colors hover:bg-ink-750 hover:text-mist-bright"
                  >
                    <FolderOpen size={12} className="text-mist-faint" /> Open folder…
                  </button>
                  {workspace && (
                    <>
                      <button
                        onClick={() => {
                          him.app.showItemInFolder(workspace);
                          setWorkspaceOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-mist transition-colors hover:bg-ink-750 hover:text-mist-bright"
                      >
                        <ExternalLink size={12} className="text-mist-faint" /> Reveal in file explorer
                      </button>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(workspace);
                          toast('success', 'Workspace path copied.');
                          setWorkspaceOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-mist transition-colors hover:bg-ink-750 hover:text-mist-bright"
                      >
                        <Copy size={12} className="text-mist-faint" /> Copy path
                      </button>
                    </>
                  )}
                  <div className="my-1 h-px bg-line" />
                  <button
                    onClick={() => {
                      setWorkspaceOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-mist transition-colors hover:bg-ink-750 hover:text-mist-bright"
                  >
                    <Settings2 size={12} className="text-mist-faint" /> Settings
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="app-no-drag flex items-center justify-center">
        <div className="relative flex h-8 items-center rounded-lg border border-line bg-ink-850/80 p-[3px] shadow-inset">
          <span
            className={cn(
              'absolute bottom-[3px] top-[3px] w-[102px] rounded-[5px] border border-line-strong bg-ink-700 shadow-inset transition-transform duration-150 ease-out',
              mode === 'agent' ? 'translate-x-0' : 'translate-x-[102px]',
            )}
          />
          <button
            data-testid="mode-agent"
            onClick={() => switchMode('agent')}
            className={cn(
              'relative z-10 flex h-full w-[102px] items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition-colors',
              mode === 'agent' ? 'text-mist-bright' : 'text-mist-faint hover:text-mist',
            )}
          >
            <Bot size={13} className={mode === 'agent' ? 'text-accent' : ''} />
            Agent
            {runningAgents > 0 || waitingAgents > 0 ? (
              <span className="ml-0.5 flex items-center">
                {waitingAgents > 0 ? (
                  <StatusDot tone="sand" />
                ) : (
                  <StatusDot tone="accent" pulse />
                )}
              </span>
            ) : null}
          </button>
          <button
            data-testid="mode-ide"
            onClick={() => switchMode('ide')}
            className={cn(
              'relative z-10 flex h-full w-[102px] items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition-colors',
              mode === 'ide' ? 'text-mist-bright' : 'text-mist-faint hover:text-mist',
            )}
          >
            <Code2 size={13} className={mode === 'ide' ? 'text-mint' : ''} />
            IDE
          </button>
        </div>
        <Tooltip label="Switch workspace mode" shortcut="Ctrl Shift M" side="bottom">
          <span className="ml-1.5 hidden h-6 items-center rounded border border-line/70 px-1.5 2xl:inline-flex">
            <Kbd>⌃⇧M</Kbd>
          </span>
        </Tooltip>
      </div>

      <div className="app-no-drag flex min-w-0 items-center justify-end gap-1">
        <ThemeMenu />
        {mode === 'agent' && activeSession?.backend === 'acp' ? (
          <AcpModelMenu session={activeSession} placement="down" />
        ) : (
          <ModelMenu />
        )}
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton
          data-testid="settings-button"
          label="Settings (Ctrl+,)"
          size="sm"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 size={13} />
        </IconButton>
        <div className="ml-1 flex items-center">
          <button
            onClick={() => him.window.minimize()}
            className="flex h-8 w-9 items-center justify-center rounded-md text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
            aria-label="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => him.window.maximize()}
            className="flex h-8 w-9 items-center justify-center rounded-md text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Copy size={10} /> : <Square size={9} />}
          </button>
          <button
            onClick={() => him.window.close()}
            className="flex h-8 w-9 items-center justify-center rounded-md text-mist-faint transition-colors hover:bg-coral/90 hover:text-white"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </header>
  );
}
