import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Code2,
  Copy,
  Eraser,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  Table2,
  Trash2,
  Type,
} from 'lucide-react';
import type { NotebookCell, NotebookDataFrame, NotebookOutput } from '@shared/types';
import type { EditorTab } from '../../types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { askAgent } from '../../lib/actions';
import { useEditorStore } from '../../store/editor';
import { useConfigStore } from '../../store/config';
import { toast } from '../../store/toast';
import { cn } from '../../lib/utils';
import type { WranglePreview } from '../../lib/notebook/wrangle';
import { MarkdownView } from '../ui';
import { CellCodeEditor } from './CellCodeEditor';
import { DataGrid } from './DataGrid';
import { InlineDataFrame } from './InlineDataFrame';
import { selectCellFrames } from '../../lib/notebook/cellFrames';
import { extractSavedFrames } from '../../lib/notebook/savedTables';

function uid(): string {
  return `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc
      .querySelectorAll('script,style,iframe,object,embed,link,meta')
      .forEach((node) => node.remove());
    doc.querySelectorAll('*').forEach((element) => {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on')) element.removeAttribute(attribute.name);
        if (name === 'href' && attribute.value.trim().toLowerCase().startsWith('javascript:')) {
          element.removeAttribute(attribute.name);
        }
      }
    });
    return doc.body.innerHTML;
  } catch {
    return '';
  }
}

function plainTextOf(output: NotebookOutput): string {
  const data = output.data || {};
  const text = data['text/plain'];
  if (Array.isArray(text)) return text.join('');
  if (typeof text === 'string') return text;
  return '';
}

function OutputView({ output }: { output: NotebookOutput }) {
  if (output.type === 'stream') {
    return (
      <pre
        className={cn(
          'whitespace-pre-wrap break-words rounded border border-line/60 bg-ink-950/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed',
          output.name === 'stderr' ? 'text-sand-soft' : 'text-mist-dim',
        )}
      >
        {output.text}
      </pre>
    );
  }
  if (output.type === 'error') {
    return (
      <pre className="thin-scrollbar max-h-[240px] overflow-auto whitespace-pre-wrap rounded border border-coral/25 bg-coral-deep/15 px-2.5 py-1.5 font-mono text-[9.5px] leading-relaxed text-coral-soft">
        {(output.traceback && output.traceback.length > 0
          ? output.traceback.join('\n')
          : `${output.ename || 'Error'}: ${output.evalue || ''}`).replace(/\u001b\[[0-9;]*m/g, '')}
      </pre>
    );
  }
  const data = output.data || {};
  const png = data['image/png'];
  const image = Array.isArray(png) ? png[0] : png;
  if (typeof image === 'string' && image.length > 0) {
    return (
      <img
        src={`data:image/png;base64,${image.replace(/\s+/g, '')}`}
        alt="Cell output"
        className="max-h-[420px] rounded border border-line/60 bg-white/95 p-1"
      />
    );
  }
  const html = data['text/html'];
  const htmlString = Array.isArray(html) ? html.join('') : html;
  if (typeof htmlString === 'string' && htmlString.trim()) {
    const cleaned = sanitizeHtml(htmlString);
    if (cleaned) {
      return (
        <div
          className="nb-html thin-scrollbar max-h-[340px] overflow-auto rounded border border-line/60 bg-ink-950/60 px-2.5 py-2"
          // Notebook HTML comes from the user's own kernel and is sanitized above.
          dangerouslySetInnerHTML={{ __html: cleaned }}
        />
      );
    }
  }
  const text = plainTextOf(output);
  if (!text.trim()) return null;
  return (
    <pre className="thin-scrollbar max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded border border-line/60 bg-ink-950/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-mist-dim">
      {text}
    </pre>
  );
}

export function NotebookView({ tab }: { tab: EditorTab }) {
  const notebook = tab.notebook!;
  const updateNotebook = useEditorStore((state) => state.updateNotebook);
  const [frames, setFrames] = useState<Record<string, NotebookDataFrame>>({});
  const [showData, setShowData] = useState(false);
  const [panelFrames, setPanelFrames] = useState<Record<string, NotebookDataFrame>>({});
  const [dataPanelMode, setDataPanelMode] = useState<'grid' | 'profile' | 'wrangle'>('grid');
  const [cellFrames, setCellFrames] = useState<
    Record<string, Record<string, NotebookDataFrame>>
  >({});
  const [savedCellIds, setSavedCellIds] = useState<Set<string>>(new Set());
  const [panelFromSaved, setPanelFromSaved] = useState(false);
  const knownFramesRef = useRef<Record<string, NotebookDataFrame>>({});
  const [runningCellId, setRunningCellId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [kernel, setKernel] = useState<'jupyter' | 'exec' | 'unknown'>('unknown');
  const [editingMarkdown, setEditingMarkdown] = useState<Record<string, boolean>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const runAllRef = useRef(false);
  const runningCellRef = useRef<string | null>(null);
  const config = useConfigStore((state) => state.config);

  useEffect(() => {
    // Restore inline DataFrame previews from outputs saved in the .ipynb, so a
    // reopened notebook shows them without re-running cells.
    const loaded = current()?.notebook;
    if (!loaded) return;
    const saved: Record<string, Record<string, NotebookDataFrame>> = {};
    for (const cell of loaded.cells) {
      if (cell.cellType !== 'code' || cell.outputs.length === 0) continue;
      const frames = extractSavedFrames(cell);
      if (Object.keys(frames).length > 0) saved[cell.id] = frames;
    }
    if (Object.keys(saved).length === 0) return;
    setSavedCellIds(new Set(Object.keys(saved)));
    setCellFrames((previous) => {
      const next = { ...previous };
      for (const [cellId, frames] of Object.entries(saved)) {
        if (!next[cellId] || Object.keys(next[cellId]).length === 0) next[cellId] = frames;
      }
      return next;
    });
    // Only on notebook load/reopen; live executions replace these per cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path]);

  useEffect(() => {
    const unsubscribe = him.nb.onStream((event) => {
      if (event.path !== tab.path) return;
      const cellId = event.token || runningCellRef.current;
      if (!cellId) return;
      if (event.token && runningCellRef.current && event.token !== runningCellRef.current) return;
      const latest = useEditorStore
        .getState()
        .tabs.find((item) => item.path === tab.path)?.notebook;
      if (!latest) return;
      const target = latest.cells.find((cell) => cell.id === cellId);
      if (!target) return;
      useEditorStore.getState().updateNotebook(tab.path, {
        ...latest,
        cells: latest.cells.map((cell) =>
          cell.id === cellId ? { ...cell, outputs: [...cell.outputs, event.output] } : cell,
        ),
      });
    });
    return unsubscribe;
  }, [tab.path]);

  const current = (): EditorTab | undefined =>
    useEditorStore.getState().tabs.find((item) => item.path === tab.path);

  useEffect(() => {
    void him.nb
      .status(tab.path)
      .then((status) => setKernel(status.kernel))
      .catch(() => undefined);
  }, [tab.path]);

  // Debounced auto-save: notebook edits persist without an explicit Ctrl+S.
  useEffect(() => {
    if (!tab.dirty) return;
    const timer = window.setTimeout(() => {
      void useEditorStore.getState().save(tab.path);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [tab.dirty, tab.notebook, tab.path]);

  const patchCell = (cellId: string, patch: Partial<NotebookCell>) => {
    const currentNotebook = current()?.notebook;
    if (!currentNotebook) return;
    updateNotebook(tab.path, {
      ...currentNotebook,
      cells: currentNotebook.cells.map((cell) =>
        cell.id === cellId ? { ...cell, ...patch } : cell,
      ),
    });
  };

  const insertCellAt = (cellType: 'code' | 'markdown', atIndex?: number): string => {
    const currentNotebook = current()?.notebook;
    if (!currentNotebook) return '';
    const cell: NotebookCell = {
      id: uid(),
      cellType,
      source: '',
      outputs: [],
      executionCount: null,
    };
    const cells = [...currentNotebook.cells];
    const index = atIndex === undefined ? cells.length : Math.max(0, Math.min(cells.length, atIndex));
    cells.splice(index, 0, cell);
    updateNotebook(tab.path, { ...currentNotebook, cells });
    if (cellType === 'markdown') {
      setEditingMarkdown((previous) => ({ ...previous, [cell.id]: true }));
    }
    return cell.id;
  };

  const insertGeneratedCell = (code: string, run: boolean) => {
    const id = insertCellAt('code');
    if (!id) return;
    // Give React/store a tick to persist the new cell before patching its source.
    window.setTimeout(() => {
      patchCell(id, { source: code });
      if (run) window.setTimeout(() => void executeCell(id), 60);
    }, 20);
  };

  const insertGeneratedAtEnd = () => {
    insertCellAt('code');
  };

  const deleteCell = (cellId: string) => {
    const currentNotebook = current()?.notebook;
    if (!currentNotebook) return;
    updateNotebook(tab.path, {
      ...currentNotebook,
      cells: currentNotebook.cells.filter((cell) => cell.id !== cellId),
    });
  };

  const duplicateCell = (cellId: string) => {
    const currentNotebook = current()?.notebook;
    const index = currentNotebook?.cells.findIndex((cell) => cell.id === cellId) ?? -1;
    if (!currentNotebook || index < 0) return;
    const source = currentNotebook.cells[index];
    const copy: NotebookCell = {
      ...source,
      id: uid(),
      outputs: [],
      executionCount: null,
    };
    const cells = [...currentNotebook.cells];
    cells.splice(index + 1, 0, copy);
    updateNotebook(tab.path, { ...currentNotebook, cells });
  };

  const moveCell = (cellId: string, direction: -1 | 1) => {
    const currentNotebook = current()?.notebook;
    if (!currentNotebook) return;
    const index = currentNotebook.cells.findIndex((cell) => cell.id === cellId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= currentNotebook.cells.length) return;
    const cells = [...currentNotebook.cells];
    const [cell] = cells.splice(index, 1);
    cells.splice(target, 0, cell);
    updateNotebook(tab.path, { ...currentNotebook, cells });
  };

  const clearOutputs = (cellId: string) => {
    patchCell(cellId, { outputs: [], executionCount: null });
    setCellFrames((previous) => {
      const next = { ...previous };
      delete next[cellId];
      return next;
    });
    setSavedCellIds((previous) => {
      if (!previous.has(cellId)) return previous;
      const next = new Set(previous);
      next.delete(cellId);
      return next;
    });
  };

  const clearAllOutputs = () => {
    const currentNotebook = current()?.notebook;
    if (!currentNotebook) return;
    updateNotebook(tab.path, {
      ...currentNotebook,
      cells: currentNotebook.cells.map((cell) => ({
        ...cell,
        outputs: [],
        executionCount: null,
      })),
    });
    setFrames({});
    setCellFrames({});
    setSavedCellIds(new Set());
    knownFramesRef.current = {};
  };

  const executeCell = async (cellId: string): Promise<void> => {
    const currentNotebook = current()?.notebook;
    const cell = currentNotebook?.cells.find((item) => item.id === cellId);
    if (!cell || cell.cellType !== 'code' || !cell.source.trim()) return;
    setRunningCellId(cellId);
    runningCellRef.current = cellId;
    const startedAt = Date.now();
    try {
      const result = await him.nb.execute(tab.path, cell.source, cellId);
      setKernel(result.kernel);
      setDurations((previous) => ({ ...previous, [cellId]: Date.now() - startedAt }));
      patchCell(cellId, {
        outputs: result.outputs,
        executionCount: result.executionCount ?? cell.executionCount ?? null,
      });
      const captured = Object.keys(result.dataframes);
      if (captured.length > 0) {
        const changed = selectCellFrames(knownFramesRef.current, result.dataframes);
        knownFramesRef.current = result.dataframes;
        setFrames(result.dataframes);
        if (useConfigStore.getState().config?.prefs.notebookAutoWrangle !== false) {
          // Inline output under the cell (PyCharm-style), not a separate panel.
          // If the rerun produced no changed frames, keep the previous inline view.
          setCellFrames((previous) =>
            Object.keys(changed).length > 0
              ? { ...previous, [cellId]: changed }
              : previous,
          );
          setSavedCellIds((previous) => {
            if (!previous.has(cellId)) return previous;
            const next = new Set(previous);
            next.delete(cellId);
            return next;
          });
        }
      }
      if (result.outputs.some((output) => output.type === 'error')) {
        toast('error', 'The cell raised an error. See the output below.', 'Cell failed');
      }
    } catch (error) {
      const message = cleanErrorMessage(error);
      if (/not running|stopped|disposed|exited|no kernel/i.test(message)) {
        toast('info', 'Cell stopped with the kernel. The next run starts a fresh kernel.', 'Notebook');
      } else {
        toast('error', message, 'Notebook kernel');
      }
    } finally {
      runningCellRef.current = null;
      setRunningCellId(null);
    }
  };

  const runCellAndInsertBelow = async (cellId: string) => {
    const currentNotebook = current()?.notebook;
    const index = currentNotebook?.cells.findIndex((cell) => cell.id === cellId) ?? -1;
    await executeCell(cellId);
    if (index >= 0) insertCellAt('code', index + 1);
  };

  const runAll = async () => {
    if (runningAll) return;
    runAllRef.current = true;
    setRunningAll(true);
    try {
      const cells = current()?.notebook?.cells || [];
      for (const cell of cells) {
        if (!runAllRef.current) break;
        const latest = current()?.notebook?.cells.find((item) => item.id === cell.id);
        if (!latest || latest.cellType !== 'code' || !latest.source.trim()) continue;
        await executeCell(cell.id);
      }
    } finally {
      runAllRef.current = false;
      setRunningAll(false);
    }
  };

  const restartKernel = async () => {
    try {
      const result = await him.nb.restart(tab.path);
      setKernel(result.kernel);
      setFrames({});
      setCellFrames({});
      setSavedCellIds(new Set());
      knownFramesRef.current = {};
      setShowData(false);
      setRunningAll(false);
      toast('success', `Kernel restarted (${result.kernel}). Outputs kept; counts reset on next run.`, 'Notebook');
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Notebook kernel');
    }
  };

  const interruptKernel = async () => {
    runAllRef.current = false;
    setRunningAll(false);
    try {
      await him.nb.interrupt(tab.path);
      toast('info', 'Sent an interrupt to the kernel.', 'Notebook');
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Notebook kernel');
    }
  };

  const saveNotebook = () => {
    void useEditorStore.getState().save(tab.path);
  };

  const askAboutDataFrame = (question: string, frameName: string, preview: WranglePreview) => {
    const sample = preview.rows.slice(0, 8);
    const lines = [
      'Analyze a notebook DataFrame in this workspace.',
      `Notebook: ${tab.path}`,
      `DataFrame variable: ${frameName}`,
      `Preview columns: ${preview.columns.join(', ')}`,
      `Preview rows captured: ${preview.rows.length} of ${frames[frameName]?.shape[0] ?? '?'}`,
      `Preview removed rows: ${preview.removed}`,
      'Sample rows:',
      JSON.stringify(sample, null, 1).slice(0, 4000),
      '',
      `Question: ${question}`,
      '',
      'Use read_notebook and run_notebook_cell on this notebook if you need more detail. Answer with concise findings and, where useful, the pandas code that would reproduce them.',
    ];
    void askAgent(lines.join('\n'));
    toast('info', 'Sent the DataFrame context to the agent.', 'AI analysis');
  };

  const frameNames = Object.keys(frames);
  const notebookLanguage =
    ((notebook.metadata as { language_info?: { name?: string } } | undefined)?.language_info
      ?.name as string) || 'python';

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-900">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-ink-900/70 px-2">
        <button
          onClick={() => void runAll()}
          disabled={runningAll}
          className="flex h-6 items-center gap-1 rounded border border-mint/25 bg-mint/[0.05] px-2 text-[9px] text-mint transition-colors hover:bg-mint/10 disabled:opacity-50"
          title="Run every code cell"
        >
          <Play size={9} fill="currentColor" /> Run all
        </button>
        <button
          onClick={() => void interruptKernel()}
          disabled={!runningAll && !runningCellId}
          className="flex h-6 items-center gap-1 rounded border border-coral/25 px-2 text-[9px] text-coral-soft transition-colors hover:bg-coral-deep/30 disabled:opacity-40"
          title="Interrupt the kernel (Ctrl+C equivalent)"
        >
          <Square size={8} fill="currentColor" /> Stop
        </button>
        <button
          onClick={() => void restartKernel()}
          className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[9px] text-mist-faint transition-colors hover:text-mist"
          title="Restart the Python kernel"
        >
          <RotateCcw size={9} /> Restart
        </button>
        <button
          onClick={clearAllOutputs}
          className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[9px] text-mist-faint transition-colors hover:text-mist"
          title="Clear every stored output"
        >
          <Eraser size={9} /> Clear outputs
        </button>
        <span
          className={cn(
            'flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[8.5px]',
            kernel === 'jupyter'
              ? 'border-mint/20 bg-mint/[0.04] text-mint/80'
              : 'border-sand/25 bg-sand/[0.04] text-sand',
          )}
          title={
            kernel === 'jupyter'
              ? 'Real Jupyter kernel (jupyter_client/ipykernel)'
              : 'Fallback in-process Python (ipykernel unavailable)'
          }
        >
          {kernel === 'jupyter' ? 'Jupyter' : kernel === 'exec' ? 'Python (fallback)' : 'Kernel'}
        </span>
        {frameNames.length > 0 && (
          <button
            onClick={() => {
              setPanelFrames(frames);
              setDataPanelMode('grid');
              setPanelFromSaved(false);
              setShowData((value) => !value);
            }}
            className={cn(
              'ml-1 flex h-6 items-center gap-1 rounded border px-2 text-[9px]',
              showData
                ? 'border-accent/25 bg-accent/[0.06] text-accent-soft'
                : 'border-line text-mist-faint hover:text-mist',
            )}
            title="Show captured DataFrames"
          >
            <Table2 size={9} /> Data ({frameNames.length})
          </button>
        )}
        <div className="flex-1" />
        {runningCellId && (
          <span className="flex items-center gap-1 text-[8.5px] text-accent/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> running
          </span>
        )}
        {tab.dirty && <span className="text-[8.5px] text-sand/80">unsaved</span>}
        <button
          onClick={saveNotebook}
          className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[9px] text-mist-faint transition-colors hover:text-mist"
          title="Save notebook (Ctrl+S) â€” also auto-saves after edits"
        >
          <Save size={9} /> Save
        </button>
        <button
          onClick={() => insertCellAt('code')}
          className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[9px] text-mist-faint transition-colors hover:text-mist"
        >
          <Code2 size={9} /> Code
        </button>
        <button
          onClick={() => insertCellAt('markdown')}
          className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[9px] text-mist-faint transition-colors hover:text-mist"
        >
          <Type size={9} /> Markdown
        </button>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-[940px] space-y-3">
          {notebook.cells.map((cell, index) => (
            <div
              key={cell.id}
              className={cn(
                'group rounded-lg border bg-ink-850/30 p-2.5 transition-colors',
                runningCellId === cell.id
                  ? 'border-accent/40'
                  : 'border-line/80 hover:border-line-strong/70',
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="font-mono text-[8px] text-mist-ghost">
                  [{cell.executionCount ?? ' '}]
                </span>
                <span className="rounded border border-line px-1 py-px font-mono text-[7.5px] uppercase tracking-wide text-mist-ghost">
                  {cell.cellType}
                </span>
                {durations[cell.id] !== undefined && (
                  <span className="font-mono text-[7.5px] text-mist-ghost">
                    {(durations[cell.id] / 1000).toFixed(2)}s
                  </span>
                )}
                <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {cell.cellType === 'code' && (
                    <button
                      onClick={() => void executeCell(cell.id)}
                      disabled={runningCellId === cell.id || runningAll}
                      className="flex h-5 items-center gap-1 rounded px-1.5 text-[8.5px] text-mint/80 hover:bg-ink-800 hover:text-mint"
                      title="Run cell (Shift+Enter)"
                    >
                      {runningCellId === cell.id ? (
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
                      ) : (
                        <Play size={8} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(cell.source);
                      toast('success', 'Cell source copied.', 'Notebook');
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-mist"
                    title="Copy cell source"
                  >
                    <Copy size={8} />
                  </button>
                  <button
                    onClick={() => duplicateCell(cell.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-mist"
                    title="Duplicate cell"
                  >
                    <Plus size={8} />
                  </button>
                  {cell.outputs.length > 0 && (
                    <button
                      onClick={() => clearOutputs(cell.id)}
                      className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-coral-soft"
                      title="Clear cell output"
                    >
                      <Eraser size={8} />
                    </button>
                  )}
                  <button
                    onClick={() => moveCell(cell.id, -1)}
                    disabled={index === 0}
                    className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-mist disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp size={8} />
                  </button>
                  <button
                    onClick={() => moveCell(cell.id, 1)}
                    disabled={index === notebook.cells.length - 1}
                    className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-mist disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown size={8} />
                  </button>
                  <button
                    onClick={() => deleteCell(cell.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-mist-ghost hover:bg-ink-800 hover:text-coral-soft"
                    title="Delete cell"
                  >
                    <Trash2 size={8} />
                  </button>
                </div>
              </div>

              {cell.cellType === 'code' ? (
                <CellCodeEditor
                  cellId={cell.id}
                  notebookPath={tab.path}
                  language={notebookLanguage}
                  value={cell.source}
                  onChange={(value) => patchCell(cell.id, { source: value })}
                  onRun={() => void executeCell(cell.id)}
                  onRunAndInsertBelow={() => void runCellAndInsertBelow(cell.id)}
                />
              ) : editingMarkdown[cell.id] ? (
                <textarea
                  value={cell.source}
                  onChange={(event) => patchCell(cell.id, { source: event.target.value })}
                  onBlur={() =>
                    setEditingMarkdown((previous) => ({ ...previous, [cell.id]: false }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      setEditingMarkdown((previous) => ({ ...previous, [cell.id]: false }));
                    }
                  }}
                  spellCheck={false}
                  rows={Math.min(16, Math.max(2, cell.source.split('\n').length))}
                  placeholder="Write Markdownâ€¦"
                  className="block w-full resize-y rounded border border-line/70 bg-ink-950 px-3 py-2 font-mono text-[11px] leading-[1.7] text-mist-bright outline-none focus:border-accent/40"
                />
              ) : (
                <div
                  onDoubleClick={() =>
                    setEditingMarkdown((previous) => ({ ...previous, [cell.id]: true }))
                  }
                  className="min-h-[22px] rounded px-1 py-0.5"
                  title="Double-click to edit markdown"
                >
                  {cell.source.trim() ? (
                    <MarkdownView content={cell.source} />
                  ) : (
                    <span className="text-[10px] text-mist-ghost">Empty markdown cell</span>
                  )}
                </div>
              )}

              {cell.outputs.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-line/50 pt-2">
                  {cell.outputs.map((output, outputIndex) => (
                    <OutputView key={`${cell.id}-${outputIndex}`} output={output} />
                  ))}
                </div>
              )}

              {cell.cellType === 'code' &&
                cellFrames[cell.id] &&
                Object.keys(cellFrames[cell.id]).length > 0 && (
                  <InlineDataFrame
                    cellId={cell.id}
                    frames={cellFrames[cell.id]}
                    saved={savedCellIds.has(cell.id)}
                    onExpand={(mode) => {
                      setPanelFrames(cellFrames[cell.id]);
                      setDataPanelMode(mode);
                      setPanelFromSaved(savedCellIds.has(cell.id));
                      setShowData(true);
                    }}
                  />
                )}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <button
              onClick={() => insertCellAt('code')}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line/70 text-[9.5px] text-mist-ghost transition-colors hover:border-line-strong hover:text-mist"
            >
              <Plus size={10} /> Add cell
            </button>
            <button
              onClick={insertGeneratedAtEnd}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[9.5px] text-mist-faint transition-colors hover:text-mist"
              title="Add an empty code cell at the end"
            >
              <Code2 size={10} /> Append code
            </button>
          </div>
          <div className="flex items-center justify-center gap-1.5 pb-2 text-[8px] text-mist-ghost">
            <Bot size={8} /> Ask the agent about this notebook, or use the Data panel&apos;s
            &ldquo;Ask AI&rdquo; button on a DataFrame.
          </div>
        </div>
      </div>

      {showData && Object.keys(panelFrames).length > 0 && (
        <div className="h-[320px] shrink-0">
          <DataGrid
            frames={panelFrames}
            initialProfileOpen={dataPanelMode === 'profile'}
            initialWrangleOpen={dataPanelMode === 'wrangle'}
            onClose={() => setShowData(false)}
            onInsertCell={panelFromSaved ? undefined : insertGeneratedCell}
            onAskAgent={askAboutDataFrame}
          />
        </div>
      )}
    </div>
  );
}

