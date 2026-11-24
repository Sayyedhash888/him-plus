import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bug,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Square,
  StepForward,
  Trash2,
} from 'lucide-react';
import type { DebugScope, DebugVariable } from '../../store/debug';
import { breakpointKey, useDebugStore } from '../../store/debug';
import { useCoreStore } from '../../store/core';
import { useEditorStore } from '../../store/editor';
import { cn, relativeTo } from '../../lib/utils';
import { Button, SectionLabel, Spinner } from '../ui';

function VariableNode({
  variable,
  depth,
  loadVariable,
}: {
  variable: DebugVariable;
  depth: number;
  loadVariable(variable: DebugVariable): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const expandable = variable.variablesReference > 0;
  return (
    <div>
      <button
        onClick={async () => {
          if (!expandable) return;
          if (!open && !variable.children) await loadVariable(variable);
          setOpen((value) => !value);
        }}
        className="flex w-full items-start gap-1 rounded px-1 py-0.5 text-left hover:bg-ink-800/70"
        style={{ paddingLeft: `${4 + depth * 10}px` }}
      >
        <span className="mt-0.5 flex w-3 shrink-0 justify-center text-mist-ghost">
          {expandable ? (
            open ? (
              <ChevronDown size={8} />
            ) : (
              <ChevronRight size={8} />
            )
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-mist-dim">
          <span className="text-azure/80">{variable.name}</span>
          {variable.type ? <span className="text-mist-ghost">: {variable.type}</span> : null}
          <span className="ml-1 text-mist-faint">{variable.value}</span>
        </span>
      </button>
      {open &&
        variable.children?.map((child, index) => (
          <VariableNode
            key={`${child.name}-${index}`}
            variable={child}
            depth={depth + 1}
            loadVariable={loadVariable}
          />
        ))}
    </div>
  );
}

function ScopeSection({
  scope,
  loadScope,
  loadVariable,
}: {
  scope: DebugScope;
  loadScope(scope: DebugScope): Promise<void>;
  loadVariable(variable: DebugVariable): Promise<void>;
}) {
  const [open, setOpen] = useState(scope.name === 'Locals');
  return (
    <div className="mb-1 overflow-hidden rounded border border-line/70">
      <button
        onClick={async () => {
          if (!open && !scope.variables) await loadScope(scope);
          setOpen((value) => !value);
        }}
        className="flex h-6 w-full items-center gap-1 bg-ink-900/60 px-1.5 text-left text-[8.5px] text-mist-faint hover:text-mist"
      >
        {open ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
        <span className="font-medium">{scope.name}</span>
        {scope.expensive && <span className="ml-auto text-[7.5px] text-mist-ghost">expensive</span>}
      </button>
      {open && (
        <div className="py-0.5">
          {scope.variables?.map((variable) => (
            <VariableNode
              key={variable.name}
              variable={variable}
              depth={0}
              loadVariable={loadVariable}
            />
          ))}
          {!scope.variables && (
            <div className="px-2 py-1 text-[8.5px] text-mist-ghost">Loading…</div>
          )}
          {scope.variables && scope.variables.length === 0 && (
            <div className="px-2 py-1 text-[8.5px] text-mist-ghost">(no variables)</div>
          )}
        </div>
      )}
    </div>
  );
}

export function DebugPane() {
  const status = useDebugStore((state) => state.status);
  const error = useDebugStore((state) => state.error);
  const breakpoints = useDebugStore((state) => state.breakpoints);
  const frames = useDebugStore((state) => state.frames);
  const scopes = useDebugStore((state) => state.scopes);
  const selectedFrameId = useDebugStore((state) => state.selectedFrameId);
  const consoleLines = useDebugStore((state) => state.consoleLines);
  const workspace = useCoreStore((state) => state.workspace);
  const revealInEditor = (path: string, line: number) => {
    void useEditorStore.getState().openFile(path).then(() => {
      useEditorStore.getState().setReveal(path, line, 1);
    });
  };

  const start = useDebugStore((state) => state.start);
  const stop = useDebugStore((state) => state.stop);
  const step = useDebugStore((state) => state.step);
  const selectFrame = useDebugStore((state) => state.selectFrame);
  const loadScope = useDebugStore((state) => state.loadScope);
  const loadVariable = useDebugStore((state) => state.loadVariable);
  const removeBreakpoint = useDebugStore((state) => state.removeBreakpoint);
  const clearBreakpoints = useDebugStore((state) => state.clearBreakpoints);

  const running = status === 'running' || status === 'stopped';
  const paused = status === 'stopped';
  const breakpointEntries = Object.entries(breakpoints);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2.5">
        <SectionLabel>Run &amp; Debug</SectionLabel>
        <span className="ml-auto flex items-center gap-1 font-mono text-[8px] text-mist-ghost">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              status === 'stopped'
                ? 'bg-sand'
                : status === 'running'
                  ? 'bg-accent'
                  : status === 'error'
                    ? 'bg-coral'
                    : 'bg-mist-ghost',
            )}
          />
          {status === 'stopped' ? 'paused' : status}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1.5">
        {!running ? (
          <Button
            size="xs"
            variant="primary"
            icon={<Play size={9} />}
            onClick={() => void start()}
            disabled={status === 'starting'}
            loading={status === 'starting'}
            title="Start debugging the active Python file (F5)"
          >
            Start
          </Button>
        ) : (
          <>
            <Button
              size="xs"
              variant="accent"
              icon={<Play size={9} />}
              onClick={() => void step('continue')}
              disabled={!paused}
              title="Continue (F5)"
            >
              Continue
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={<StepForward size={9} />}
              onClick={() => void step('next')}
              disabled={!paused}
              title="Step over (F10)"
            >
              Over
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={<ArrowDownToLine size={9} />}
              onClick={() => void step('stepIn')}
              disabled={!paused}
              title="Step into (F11)"
            >
              Into
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={<ArrowUpFromLine size={9} />}
              onClick={() => void step('stepOut')}
              disabled={!paused}
              title="Step out (Shift+F11)"
            >
              Out
            </Button>
            {!paused && (
              <Button
                size="xs"
                variant="ghost"
                icon={<Pause size={9} />}
                onClick={() => void step('pause')}
                title="Pause"
              />
            )}
            <Button
              size="xs"
              variant="ghost"
              icon={<Square size={9} />}
              onClick={() => void stop()}
              title="Stop debugging (Shift+F5)"
            >
              Stop
            </Button>
          </>
        )}
        <button
          onClick={() => void start()}
          disabled={running}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist disabled:opacity-40"
          title="Restart debug session"
          aria-label="Restart debug session"
        >
          <RotateCcw size={9} />
        </button>
      </div>

      {error && (
        <div className="mx-2 mt-1.5 rounded border border-coral/25 bg-coral-deep/15 px-2 py-1.5 text-[8.5px] leading-relaxed text-coral-soft">
          {error}
        </div>
      )}

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-2">
          <div className="flex items-center gap-1 px-1 pb-1">
            <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Breakpoints
            </span>
            <span className="font-mono text-[8px] text-mist-ghost">
              {breakpointEntries.reduce((total, [, lines]) => total + lines.length, 0)}
            </span>
            {breakpointEntries.length > 0 && (
              <button
                onClick={clearBreakpoints}
                className="ml-auto flex h-4 items-center gap-0.5 rounded px-1 text-[8px] text-mist-ghost hover:text-coral-soft"
                title="Remove all breakpoints"
              >
                <Trash2 size={8} /> Clear
              </button>
            )}
          </div>
          {breakpointEntries.length === 0 && (
            <p className="px-1 text-[8.5px] leading-relaxed text-mist-ghost">
              Click in the editor&apos;s glyph margin (or press F9) to add a breakpoint.
            </p>
          )}
          {breakpointEntries.map(([key, lines]) => {
            const displayPath = workspace ? relativeTo(workspace, key) : key;
            return (
              <div key={key} className="mb-0.5">
                <div className="truncate px-1 font-mono text-[8.5px] text-mist-faint" title={key}>
                  {displayPath}
                </div>
                {lines.map((line) => (
                  <div
                    key={`${key}-${line}`}
                    className="group flex h-5 items-center gap-1 rounded px-1.5 hover:bg-ink-800/70"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-coral/80" />
                    <button
                      onClick={() => revealInEditor(key, line)}
                      className="flex-1 text-left font-mono text-[9px] text-mist-dim hover:text-mist-bright"
                    >
                      line {line}
                    </button>
                    <button
                      onClick={() => removeBreakpoint(key, line)}
                      className="flex h-4 w-4 items-center justify-center rounded text-mist-ghost opacity-0 hover:text-coral-soft group-hover:opacity-100"
                      aria-label={`Remove breakpoint at line ${line}`}
                    >
                      <Trash2 size={8} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {frames.length > 0 && (
          <div className="mb-2">
            <div className="px-1 pb-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Call stack
            </div>
            {frames.map((frame) => (
              <button
                key={frame.id}
                onClick={() => void selectFrame(frame.id)}
                className={cn(
                  'flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left',
                  frame.id === selectedFrameId ? 'bg-ink-750' : 'hover:bg-ink-800/70',
                )}
                title={frame.path || frame.name}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-mist-dim">
                  {frame.name}
                </span>
                <span className="shrink-0 font-mono text-[8px] text-mist-ghost">
                  {frame.path ? `${frame.path.split(/[\\/]/).pop()}:${frame.line}` : `line ${frame.line}`}
                </span>
              </button>
            ))}
          </div>
        )}

        {scopes.length > 0 && (
          <div className="mb-2">
            <div className="px-1 pb-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Variables
            </div>
            {scopes.map((scope) => (
              <ScopeSection
                key={scope.name}
                scope={scope}
                loadScope={loadScope}
                loadVariable={loadVariable}
              />
            ))}
          </div>
        )}

        {consoleLines.length > 0 && (
          <div>
            <div className="px-1 pb-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-mist-faint">
              Debug console
            </div>
            <pre className="thin-scrollbar max-h-[200px] overflow-auto rounded border border-line/70 bg-ink-950 px-1.5 py-1 font-mono text-[8.5px] leading-relaxed text-mist-dim">
              {consoleLines.join('')}
            </pre>
          </div>
        )}

        {status === 'idle' && frames.length === 0 && (
          <div className="mt-4 flex flex-col items-center gap-1.5 px-3 text-center">
            <Bug size={15} className="text-mist-faint" />
            <span className="text-[9px] leading-relaxed text-mist-ghost">
              Python debugging uses debugpy (pip install debugpy). Open a .py file, set
              breakpoints, then press F5.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

