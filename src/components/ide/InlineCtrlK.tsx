import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  ArrowUp,
  Check,
  CornerDownLeft,
  MessageSquare,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { cn, clamp, shortModelName, truncate } from '../../lib/utils';
import { buildDiffRows, countDiffRows } from '../../lib/diff';
import { generateInlineEdit } from '../../lib/inline';
import { validateInlineOutput } from '../../lib/inlineValidation';
import { resolveDefaultModel, useConfigStore } from '../../store/config';
import { toast } from '../../store/toast';
import { Spinner } from '../ui';

export interface InlineSession {
  editor: Monaco.editor.IStandaloneCodeEditor;
  range: Monaco.Range;
  original: string;
  language: string;
  filePath: string;
  contextBefore: string;
  contextAfter: string;
  anchor: { top: number; left: number; height: number };
  containerWidth: number;
  containerHeight: number;
  lineCount: number;
}

export function InlineCtrlK({
  session,
  onClose,
}: {
  session: InlineSession;
  onClose(): void;
}) {
  const config = useConfigStore((state) => state.config);
  const fast = resolveDefaultModel(config, 'fast') || resolveDefaultModel(config, 'primary');
  const [instruction, setInstruction] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(true);
  const [isRefinement, setIsRefinement] = useState(false);
  const [modelLabel, setModelLabel] = useState(
    fast ? `${fast.provider.name} · ${shortModelName(fast.model.id)}` : 'No fast model',
  );
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const diffRows = generated !== null ? buildDiffRows(session.original, generated, 160) : [];
  const stats = countDiffRows(diffRows);

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputOpen]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (inputOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        controllerRef.current?.abort();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [inputOpen, onClose]);

  const run = async (refine = false) => {
    const value = instruction.trim();
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('running');
    setError(null);
    setInputOpen(false);
    setGenerated(session.original);
    try {
      const result = await generateInlineEdit({
        instruction: value,
        targetCode: session.original,
        filePath: session.filePath,
        language: session.language,
        contextBefore: session.contextBefore,
        contextAfter: session.contextAfter,
        previousAttempt: refine && generated ? generated : undefined,
        signal: controller.signal,
        onDelta: (text) => setGenerated(text),
      });
      setGenerated(result.code);
      setModelLabel(result.modelLabel);
      setStatus('done');
    } catch (runError) {
      if (controller.signal.aborted) return;
      setError((runError as Error).message);
      setStatus('error');
    }
  };

  const accept = () => {
    if (generated === null) return;
    const model = session.editor.getModel();
    if (!model) return;
    const current = model.getValueInRange(session.range);
    if (current !== session.original) {
      setError('The target code changed while generating. Close and run the command again.');
      setStatus('error');
      return;
    }
    // Never apply raw model/streaming text: re-validate right before writing.
    const validated = validateInlineOutput(session.original, generated);
    if (!validated.ok) {
      if (validated.reason === 'no change') {
        toast('info', 'The model proposed no changes.');
        onClose();
        return;
      }
      setError(
        `The model returned invalid edit output (${validated.reason ?? 'unknown reason'}) - nothing was applied.`,
      );
      setStatus('error');
      return;
    }
    session.editor.pushUndoStop();
    session.editor.executeEdits('him-inline-edit', [
      { range: session.range, text: validated.code, forceMoveMarkers: true },
    ]);
    session.editor.pushUndoStop();
    session.editor.focus();
    toast('success', 'Inline edit applied to the buffer. Save with Ctrl+S.', 'Applied');
    onClose();
  };

  const reject = () => {
    controllerRef.current?.abort();
    onClose();
  };

  const width = Math.min(640, Math.max(340, session.containerWidth - 24));
  const left = clamp(session.anchor.left - 26, 8, session.containerWidth - width - 8);
  const above = session.anchor.top > 280;
  const maxHeight = above
    ? Math.max(220, session.anchor.top - 22)
    : Math.max(220, session.containerHeight - session.anchor.top - 24);

  return (
    <div
      className="absolute z-[45] flex flex-col overflow-hidden rounded-lg border border-accent/30 bg-ink-800/98 shadow-panel backdrop-blur animate-slide-up"
      style={{
        width,
        left,
        top: above ? session.anchor.top - 7 : session.anchor.top + session.anchor.height + 8,
        transform: above ? 'translateY(-100%)' : undefined,
        maxHeight,
      } as CSSProperties}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className="text-accent" />
          <span className="text-[10px] font-semibold tracking-[0.01em] text-mist-bright">
            HIM Inline
          </span>
        </div>
        <span className="hidden truncate font-mono text-[8.5px] text-mist-ghost sm:inline">
          {session.language} · {session.lineCount} line{session.lineCount === 1 ? '' : 's'}
        </span>
        <span className="ml-auto hidden truncate font-mono text-[8px] text-mist-ghost md:inline">
          {modelLabel}
        </span>
        {status === 'running' && <Spinner size={10} />}
        <button
          onClick={reject}
          className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-750 hover:text-mist"
          aria-label="Close inline edit"
        >
          <X size={11} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {inputOpen && (
          <div className="p-2.5">
            <div className="flex items-end gap-2 rounded-md border border-line bg-ink-900/70 px-2.5 py-2 focus-within:border-accent/35">
              <textarea
                ref={inputRef}
                rows={1}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void run(isRefinement);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    if (generated !== null) {
                      setInputOpen(false);
                    } else {
                      reject();
                    }
                  }
                }}
                placeholder={
                  isRefinement
                    ? 'Refine the previous proposal…'
                    : 'Describe the change for this selection…'
                }
                className="him-textarea max-h-[90px] min-h-[24px] flex-1 border-0 bg-transparent text-[11px] leading-relaxed text-mist-bright outline-none placeholder:text-mist-ghost"
              />
              <button
                onClick={() => void run(isRefinement)}
                disabled={!instruction.trim()}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded',
                  instruction.trim()
                    ? 'bg-accent text-ink-950 hover:bg-accent-soft'
                    : 'bg-ink-700 text-mist-ghost',
                )}
                aria-label="Generate inline edit"
              >
                <ArrowUp size={11} />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2 px-0.5 font-mono text-[8px] text-mist-ghost">
              <span>
                <CornerDownLeft size={8} className="-mt-px mr-0.5 inline" />
                Enter to {isRefinement ? 'refine' : 'generate'}
              </span>
              <span>Shift+Enter newline</span>
              <span>Esc close</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-2.5 my-2 rounded border border-coral/25 bg-coral-deep/20 px-2.5 py-2 text-[9.5px] leading-relaxed text-coral-soft">
            {error}
          </div>
        )}

        {(generated !== null || status === 'running') && (
          <div className="px-2.5 pb-2">
            <div className="mb-1 flex items-center gap-1.5 px-0.5">
              <span className="text-[8px] font-semibold uppercase tracking-[0.13em] text-mist-ghost">
                Proposed diff
              </span>
              <span className="font-mono text-[8px] text-mint">+{stats.added}</span>
              <span className="font-mono text-[8px] text-coral">âˆ’{stats.removed}</span>
              <span className="ml-auto truncate font-mono text-[8px] text-mist-ghost">
                {truncate(session.filePath, 48)}
              </span>
            </div>
            <div className="thin-scrollbar max-h-[250px] overflow-auto rounded-md border border-line bg-ink-950/70">
              {diffRows.length === 0 && status === 'running' && (
                <div className="flex items-center gap-2 px-2.5 py-2 text-[9px] text-mist-faint">
                  <Spinner size={9} /> Generating code…
                </div>
              )}
              {diffRows.length === 0 && status === 'done' && (
                <div className="px-2.5 py-2 text-[9px] text-mist-faint">
                  No line changes proposed.
                </div>
              )}
              {diffRows.map((row, index) => (
                <div
                  key={`${index}-${row.type}`}
                  className={cn(
                    'flex whitespace-pre font-mono text-[10px] leading-[1.6]',
                    row.type === 'add'
                      ? 'bg-mint/[0.055] text-mint-soft'
                      : row.type === 'remove'
                        ? 'bg-coral/[0.055] text-coral-soft/90'
                        : 'text-mist-faint',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 shrink-0 select-none border-r border-line/60 text-center text-[9px]',
                      row.type === 'add'
                        ? 'text-mint/70'
                        : row.type === 'remove'
                          ? 'text-coral/70'
                          : 'text-mist-ghost',
                    )}
                  >
                    {row.type === 'add' ? '+' : row.type === 'remove' ? 'âˆ’' : ''}
                  </span>
                  <span className="w-7 shrink-0 select-none border-r border-line/60 pr-1 text-right text-[8px] text-mist-ghost">
                    {row.type === 'remove' ? row.oldLine : row.newLine}
                  </span>
                  <span className="min-w-0 flex-1 overflow-x-auto px-2">{row.text || ' '}</span>
                </div>
              ))}
              {status === 'running' && generated && (
                <span className="stream-caret ml-2 inline-block h-2.5 align-middle" />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1.5 border-t border-line bg-ink-850/60 px-2.5">
        <span className="hidden font-mono text-[8px] text-mist-ghost sm:inline">
          {status === 'done' ? 'Review the diff before applying' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {status === 'done' && generated !== null && (
            <button
              onClick={() => {
                setIsRefinement(true);
                setInstruction('');
                setInputOpen(true);
              }}
              className="flex h-6 items-center gap-1 rounded border border-line px-1.5 text-[9px] text-mist-faint transition-colors hover:border-line-strong hover:text-mist"
            >
              <MessageSquare size={9} /> Follow-up
            </button>
          )}
          {status === 'error' && (
            <button
              onClick={() => {
                setStatus('idle');
                setError(null);
                setInputOpen(true);
              }}
              className="flex h-6 items-center gap-1 rounded border border-line px-1.5 text-[9px] text-mist-faint hover:border-line-strong hover:text-mist"
            >
              <RotateCcw size={9} /> Edit prompt
            </button>
          )}
          <button
            onClick={reject}
            className="flex h-6 items-center rounded px-1.5 text-[9px] text-mist-faint transition-colors hover:bg-ink-750 hover:text-mist"
          >
            {status === 'running' ? 'Stop' : 'Reject'}
          </button>
          <button
            onClick={accept}
            disabled={status !== 'done' || generated === null}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-[9px] font-medium transition-colors',
              status === 'done' && generated !== null
                ? 'bg-accent text-ink-950 hover:bg-accent-soft'
                : 'bg-ink-700 text-mist-ghost',
            )}
          >
            <Check size={9} /> Accept
          </button>
        </div>
      </div>
    </div>
  );
}

