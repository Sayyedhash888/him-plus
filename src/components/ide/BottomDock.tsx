import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Plus,
  SquareTerminal,
  Terminal,
  X,
} from 'lucide-react';
import type { TerminalTabInfo } from '../../types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { toast } from '../../store/toast';
import { askAgentToFix, openWorkspace } from '../../lib/actions';
import { Button, IconButton } from '../ui';
import { ProblemsPane } from './ProblemsPane';
import { TerminalPane, type TerminalFailure } from './TerminalPane';

function shellLabel(shell: string): string {
  const base = shell.split(/[\\/]/).pop() || shell;
  return base.replace(/\.exe$/i, '') || 'shell';
}

export function BottomDock({ active }: { active: boolean }) {
  const workspace = useCoreStore((state) => state.workspace);
  const bottomOpen = useEditorStore((state) => state.bottomOpen);
  const bottomTab = useEditorStore((state) => state.bottomTab);
  const setBottomTab = useEditorStore((state) => state.setBottomTab);
  const setBottomOpen = useEditorStore((state) => state.setBottomOpen);
  const bottomHeight = useEditorStore((state) => state.bottomHeight);
  const setBottomHeight = useEditorStore((state) => state.setBottomHeight);
  const problems = useEditorStore((state) => state.problems);
  const terminalCommandRequest = useEditorStore((state) => state.terminalCommandRequest);
  const clearTerminalCommand = useEditorStore((state) => state.clearTerminalCommand);
  const [terminals, setTerminals] = useState<TerminalTabInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<{
    terminalId: string;
    id: number;
    command: string;
  } | null>(null);
  const terminalsRef = useRef(terminals);
  const creatingRef = useRef(false);
  const counterRef = useRef(1);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  const spawnTerminal = useCallback(async (): Promise<TerminalTabInfo | null> => {
    if (!workspace || creatingRef.current) return null;
    creatingRef.current = true;
    try {
      const created = await him.pty.create(workspace);
      const info: TerminalTabInfo = {
        id: created.id,
        cwd: created.cwd,
        shell: created.shell,
        title: `${shellLabel(created.shell)} ${counterRef.current}`,
      };
      counterRef.current += 1;
      setTerminals((previous) => [...previous, info]);
      setActiveTerminalId(info.id);
      return info;
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Could not start terminal');
      return null;
    } finally {
      creatingRef.current = false;
    }
  }, [workspace]);

  useEffect(() => {
    if (bottomOpen && workspace && terminalsRef.current.length === 0) {
      void spawnTerminal();
    }
  }, [bottomOpen, workspace, spawnTerminal]);

  useEffect(() => {
    if (!terminalCommandRequest) return;
    const request = terminalCommandRequest;
    clearTerminalCommand(request.id);
    if (!workspace) {
      toast('error', 'Open a folder before running a file.', 'No workspace');
      return;
    }
    setBottomOpen(true);
    setBottomTab('terminal');
    const route = async () => {
      const existing = request.newTerminal
        ? null
        : terminalsRef.current.find((terminal) => terminal.id === activeTerminalId) ||
          terminalsRef.current[0] ||
          null;
      const target = existing || (await spawnTerminal());
      if (!target) return;
      setActiveTerminalId(target.id);
      setPendingCommand({
        terminalId: target.id,
        id: request.id,
        command: request.command,
      });
    };
    void route();
  }, [
    terminalCommandRequest,
    workspace,
    activeTerminalId,
    spawnTerminal,
    clearTerminalCommand,
    setBottomOpen,
    setBottomTab,
  ]);

  useEffect(() => {
    if (!bottomOpen || !active) return;
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - event.clientY;
      const next = Math.max(
        170,
        Math.min(window.innerHeight * 0.68, dragRef.current.startHeight + delta),
      );
      setBottomHeight(next);
    };
    const handleUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [bottomOpen, active, setBottomHeight]);

  useEffect(() => {
    return () => {
      for (const terminal of terminalsRef.current) {
        void him.pty.dispose(terminal.id);
      }
    };
  }, []);

  const closeTerminal = (id: string) => {
    void him.pty.dispose(id);
    setPendingCommand((current) => (current?.terminalId === id ? null : current));
    setTerminals((previous) => {
      const index = previous.findIndex((terminal) => terminal.id === id);
      const next = previous.filter((terminal) => terminal.id !== id);
      if (activeTerminalId === id) {
        setActiveTerminalId(next[Math.min(index, next.length - 1)]?.id || null);
      }
      return next;
    });
  };

  const handleFailure = (failure: TerminalFailure) => {
    void askAgentToFix({
      title: 'Fix a failing terminal command',
      details: [
        `Command: ${failure.command}`,
        `Working directory: ${failure.cwd}`,
        `Exit code: ${failure.code ?? 'unknown'}`,
        '',
        'Output:',
        failure.output.slice(-6000),
      ].join('\n'),
      createIfMissing: true,
    });
  };

  const errorCount = problems.filter((problem) => problem.severity === 1).length;
  const height = Math.max(170, Math.min(window.innerHeight * 0.68, bottomHeight));

  return (
    <section
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden border-t border-line bg-ink-950',
        bottomOpen ? '' : 'hidden',
      )}
      style={{ height }}
    >
      <div
        onMouseDown={(event) => {
          event.preventDefault();
          dragRef.current = { startY: event.clientY, startHeight: height };
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'row-resize';
        }}
        className="absolute inset-x-0 top-0 z-20 flex h-1.5 cursor-row-resize items-center justify-center hover:bg-accent/10"
        title="Drag to resize panel"
      >
        <span className="h-[2px] w-8 rounded-full bg-line-strong/80" />
      </div>
      <div className="flex h-[34px] shrink-0 items-stretch border-b border-line bg-ink-900/50 pt-px">
        <button
          onClick={() => setBottomTab('terminal')}
          className={cn(
            'relative flex h-full items-center gap-1.5 px-3 text-[9.5px] transition-colors',
            bottomTab === 'terminal'
              ? 'text-mist-bright'
              : 'text-mist-faint hover:text-mist',
          )}
        >
          <Terminal size={11} className={bottomTab === 'terminal' ? 'text-accent' : ''} />
          Terminal
          {bottomTab === 'terminal' && (
            <span className="absolute inset-x-2 bottom-0 h-px bg-accent/60" />
          )}
        </button>
        <button
          onClick={() => setBottomTab('problems')}
          className={cn(
            'relative flex h-full items-center gap-1.5 px-3 text-[9.5px] transition-colors',
            bottomTab === 'problems'
              ? 'text-mist-bright'
              : 'text-mist-faint hover:text-mist',
          )}
        >
          <AlertTriangle
            size={10}
            className={bottomTab === 'problems' ? 'text-sand' : errorCount > 0 ? 'text-sand/70' : ''}
          />
          Problems
          {problems.length > 0 && (
            <span
              className={cn(
                'rounded px-1 py-px font-mono text-[8px]',
                errorCount > 0 ? 'bg-coral/10 text-coral' : 'text-mist-ghost',
              )}
            >
              {problems.length}
            </span>
          )}
          {bottomTab === 'problems' && (
            <span className="absolute inset-x-2 bottom-0 h-px bg-accent/60" />
          )}
        </button>

        {bottomTab === 'terminal' && (
          <>
            <div className="mx-1 my-2 w-px bg-line" />
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1">
              {terminals.map((terminal) => (
                <button
                  key={terminal.id}
                  onClick={() => setActiveTerminalId(terminal.id)}
                  title={terminal.cwd}
                  className={cn(
                    'group flex h-6 min-w-[78px] max-w-[150px] shrink-0 items-center gap-1 rounded px-1.5 text-left font-mono text-[8.5px] transition-colors',
                    activeTerminalId === terminal.id
                      ? 'bg-ink-800 text-mist'
                      : 'text-mist-faint hover:bg-ink-850 hover:text-mist',
                  )}
                >
                  <SquareTerminal size={9} className="shrink-0 text-mist-ghost" />
                  <span className="min-w-0 flex-1 truncate">{terminal.title}</span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTerminal(terminal.id);
                    }}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-mist-ghost opacity-0 hover:bg-ink-700 hover:text-mist group-hover:opacity-100"
                    aria-label={`Close ${terminal.title}`}
                  >
                    <X size={8} />
                  </span>
                </button>
              ))}
              <button
                onClick={() => {
                  setBottomTab('terminal');
                  void spawnTerminal();
                }}
                disabled={!workspace}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-mist-ghost transition-colors hover:bg-ink-800 hover:text-mist disabled:opacity-40"
                title="New terminal"
              >
                <Plus size={11} />
              </button>
            </div>
          </>
        )}
        {bottomTab === 'problems' && <div className="flex-1" />}
        <div className="flex shrink-0 items-center px-1">
          <IconButton
            label="Collapse panel"
            size="xs"
            onClick={() => setBottomOpen(false)}
          >
            <ChevronDown size={12} />
          </IconButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {bottomTab === 'terminal' ? (
          !workspace ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-[10px] text-mist-faint">Open a workspace to start a terminal</div>
              <Button
                size="xs"
                variant="ghost"
                className="mt-2"
                onClick={() => void openWorkspace()}
              >
                Open folder
              </Button>
            </div>
          ) : terminals.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-[10px] text-mist-faint">No terminal sessions</div>
              <Button
                size="xs"
                variant="outline"
                className="mt-2"
                icon={<Plus size={10} />}
                onClick={() => void spawnTerminal()}
              >
                New terminal
              </Button>
            </div>
          ) : (
            <div className="h-full">
              {terminals.map((terminal) => (
                <TerminalPane
                  key={terminal.id}
                  terminal={terminal}
                  isVisible={active && bottomTab === 'terminal' && terminal.id === activeTerminalId}
                  onFailure={handleFailure}
                  commandRequest={
                    pendingCommand?.terminalId === terminal.id ? pendingCommand : null
                  }
                  onCommandConsumed={(id) =>
                    setPendingCommand((current) => (current?.id === id ? null : current))
                  }
                />
              ))}
            </div>
          )
        ) : (
          <ProblemsPane />
        )}
      </div>
    </section>
  );
}
