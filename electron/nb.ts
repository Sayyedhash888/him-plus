import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseNotebookFileText } from '../shared/notebookParse';
import type {
  NotebookCell,
  NotebookData,
  NotebookExecution,
  NotebookOutput,
} from '../shared/types';

interface BridgePending {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  onPartial?(partial: unknown): void;
}

interface Bridge {
  process: ChildProcessWithoutNullStreams;
  ready: Promise<{ kernel: 'jupyter' | 'exec'; pandas: boolean }>;
  pending: Map<string, BridgePending>;
  queue: Promise<unknown>;
  kernel: 'jupyter' | 'exec' | 'unknown';
  disposed: boolean;
}

const bridges = new Map<string, Bridge>();

function bridgeScriptPath(): string {
  return path.join(__dirname, 'nbKernelBridge.py');
}

function pythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startBridge(notebookPath: string): Bridge {
  const script = bridgeScriptPath();
  const cwd = path.dirname(notebookPath);
  const child = spawn(pythonCommand(), ['-u', script], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (chunk.trim()) console.warn('[notebook]', chunk.trim().slice(0, 500));
  });

  let resolveReady: (value: { kernel: 'jupyter' | 'exec'; pandas: boolean }) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<{ kernel: 'jupyter' | 'exec'; pandas: boolean }>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  const readyTimer = setTimeout(() => {
    rejectReady(
      new Error(
        'The Python notebook kernel did not start. Ensure Python is installed and on PATH (python -c "import ipykernel").',
      ),
    );
  }, 90_000);
  readyTimer.unref?.();

  const bridge: Bridge = {
    process: child,
    ready,
    pending: new Map(),
    queue: Promise.resolve(),
    kernel: 'unknown',
    disposed: false,
  };

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.ready) {
      clearTimeout(readyTimer);
      const kernel = message.kernel === 'jupyter' ? 'jupyter' : 'exec';
      bridge.kernel = kernel;
      resolveReady({ kernel, pandas: message.pandas === true });
      return;
    }
    const id = typeof message.id === 'string' ? message.id : '';
    const pending = id ? bridge.pending.get(id) : undefined;
    if (!pending) return;
    if (message.partial !== undefined) {
      pending.onPartial?.(message.partial);
      return;
    }
    bridge.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.ok === false) {
      pending.reject(new Error(String(message.error || 'Notebook execution failed.')));
    } else {
      pending.resolve(message);
    }
  });

  child.on('error', (error) => {
    clearTimeout(readyTimer);
    rejectReady(error);
    for (const pending of bridge.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    bridge.pending.clear();
  });
  child.on('exit', () => {
    bridge.disposed = true;
    for (const pending of bridge.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The notebook kernel exited.'));
    }
    bridge.pending.clear();
  });

  bridges.set(notebookPath, bridge);
  return bridge;
}

async function ensureBridge(notebookPath: string): Promise<Bridge> {
  const existing = bridges.get(notebookPath);
  if (existing && !existing.disposed) {
    await existing.ready;
    return existing;
  }
  if (existing) bridges.delete(notebookPath);
  const bridge = startBridge(notebookPath);
  await bridge.ready;
  return bridge;
}

function request(
  bridge: Bridge,
  payload: Record<string, unknown>,
  timeoutMs = 180_000,
  onPartial?: (partial: unknown) => void,
): Promise<Record<string, unknown>> {
  const id = `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pending.delete(id);
      reject(new Error('The notebook kernel timed out.'));
    }, timeoutMs);
    bridge.pending.set(id, { resolve, reject, timer, onPartial });
    bridge.process.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
  });
}

function normalizeOutputs(raw: unknown): NotebookOutput[] {
  if (!Array.isArray(raw)) return [];
  const outputs: NotebookOutput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const type = item.output_type;
    if (type === 'stream') {
      outputs.push({
        type: 'stream',
        name: typeof item.name === 'string' ? item.name : 'stdout',
        text: Array.isArray(item.text) ? item.text.join('') : String(item.text || ''),
      });
    } else if (type === 'error') {
      outputs.push({
        type: 'error',
        ename: typeof item.ename === 'string' ? item.ename : 'Error',
        evalue: typeof item.evalue === 'string' ? item.evalue : '',
        traceback: Array.isArray(item.traceback)
          ? item.traceback.filter((line): line is string => typeof line === 'string')
          : [],
      });
    } else if (type === 'execute_result' || type === 'display_data') {
      const data = (item.data && typeof item.data === 'object' ? item.data : {}) as Record<
        string,
        string | string[]
      >;
      outputs.push({
        type: type === 'execute_result' ? 'result' : 'display',
        data,
        executionCount:
          typeof item.execution_count === 'number' ? item.execution_count : null,
      });
    }
  }
  return outputs;
}

function normalizeCell(raw: unknown, index: number): NotebookCell {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const source = Array.isArray(item.source)
    ? item.source.join('')
    : typeof item.source === 'string'
      ? item.source
      : '';
  const cellType =
    item.cell_type === 'markdown' ? 'markdown' : item.cell_type === 'raw' ? 'raw' : 'code';
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `cell-${index}-${Date.now().toString(36)}`,
    cellType,
    source,
    outputs: normalizeOutputs(item.outputs),
    executionCount: typeof item.execution_count === 'number' ? item.execution_count : null,
  };
}

export async function openNotebook(notebookPath: string): Promise<NotebookData> {
  const resolved = path.resolve(notebookPath);
  const text = await fs.readFile(resolved, 'utf8');
  let parsed;
  try {
    parsed = parseNotebookFileText(path.basename(resolved), text);
  } catch (error) {
    const checkpoint = path.join(
      path.dirname(resolved),
      '.ipynb_checkpoints',
      `${path.basename(resolved, path.extname(resolved))}-checkpoint.ipynb`,
    );
    const recovery = fsSync.existsSync(checkpoint)
      ? ` A Jupyter checkpoint exists at ${checkpoint} — open it to recover the last saved version.`
      : ' The file is empty or truncated; if JupyterLab/VS Code had this notebook open, check its recovery history.';
    throw new Error(`${(error as Error).message}${recovery}`);
  }
  const raw = parsed.raw;
  const cells = Array.isArray(raw.cells) ? raw.cells.map(normalizeCell) : [];
  const metadata = (raw.metadata && typeof raw.metadata === 'object'
    ? raw.metadata
    : {}) as Record<string, unknown>;
  const kernelspec = metadata.kernelspec as Record<string, unknown> | undefined;
  return {
    path: resolved,
    cells:
      cells.length > 0
        ? cells
        : [{ id: `cell-${Date.now().toString(36)}`, cellType: 'code', source: '', outputs: [] }],
    metadata,
    nbformat: typeof raw.nbformat === 'number' ? raw.nbformat : 4,
    nbformatMinor: typeof raw.nbformat_minor === 'number' ? raw.nbformat_minor : 5,
    kernelName: kernelspec && typeof kernelspec.name === 'string' ? kernelspec.name : 'python3',
    warning: parsed.warning,
  };
}

function serializeOutputs(cell: NotebookCell): unknown[] {
  const outputs: unknown[] = [];
  for (const output of cell.outputs) {
    if (output.type === 'stream') {
      if (!output.text) continue;
      outputs.push({ output_type: 'stream', name: output.name || 'stdout', text: output.text });
    } else if (output.type === 'error') {
      outputs.push({
        output_type: 'error',
        ename: output.ename || 'Error',
        evalue: output.evalue || '',
        traceback: output.traceback || [],
      });
    } else if (output.data) {
      outputs.push({
        output_type: output.type === 'result' ? 'execute_result' : 'display_data',
        data: output.data,
        metadata: {},
        execution_count: output.executionCount ?? null,
      });
    }
  }
  return outputs;
}

export async function saveNotebook(data: NotebookData): Promise<void> {
  const resolved = path.resolve(data.path);
  const payload = {
    cells: data.cells.map((cell) => ({
      cell_type: cell.cellType,
      id: cell.id,
      metadata: {},
      source: cell.source,
      ...(cell.cellType === 'code'
        ? {
            outputs: serializeOutputs(cell),
            execution_count: cell.executionCount ?? null,
          }
        : {}),
    })),
    metadata: data.metadata,
    nbformat: data.nbformat || 4,
    nbformat_minor: data.nbformatMinor || 5,
  };
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
}

export async function executeNotebook(
  notebookPath: string,
  code: string,
  token?: string,
  sender?: Electron.WebContents,
): Promise<NotebookExecution> {
  const bridge = await ensureBridge(notebookPath);
  const run = () =>
    request(
      bridge,
      { op: 'execute', code, token },
      180_000,
      (partial) => {
        if (!sender || sender.isDestroyed()) return;
        sender.send('nb:stream', { path: notebookPath, token, output: partial });
      },
    );
  const result = (await (bridge.queue = bridge.queue.then(run, run))) as Record<
    string,
    unknown
  >;
  return {
    ok: true,
    kernel: bridge.kernel,
    executionCount:
      typeof result.executionCount === 'number' ? result.executionCount : null,
    outputs: normalizeOutputs(result.outputs),
    dataframes:
      result.dataframes && typeof result.dataframes === 'object'
        ? (result.dataframes as NotebookExecution['dataframes'])
        : {},
  };
}

export async function restartNotebookKernel(
  notebookPath: string,
): Promise<{ kernel: 'jupyter' | 'exec' | 'unknown' }> {
  const existing = bridges.get(notebookPath);
  if (!existing || existing.disposed) {
    const bridge = await ensureBridge(notebookPath);
    return { kernel: bridge.kernel };
  }
  await request(existing, { op: 'restart' });
  return { kernel: existing.kernel };
}

export async function interruptNotebookKernel(notebookPath: string): Promise<void> {
  const bridge = bridges.get(notebookPath);
  if (!bridge || bridge.disposed) return;
  try {
    await request(bridge, { op: 'interrupt' }, 10_000);
  } catch {
    // Interrupt is best effort; restarting the kernel always works.
  }
}

export function notebookStatus(notebookPath: string): {
  running: boolean;
  kernel: 'jupyter' | 'exec' | 'unknown';
} {
  const bridge = bridges.get(notebookPath);
  return {
    running: Boolean(bridge && !bridge.disposed),
    kernel: bridge?.kernel || 'unknown',
  };
}

export function disposeNotebook(notebookPath: string): void {
  const bridge = bridges.get(notebookPath);
  if (!bridge) return;
  bridges.delete(notebookPath);
  try {
    bridge.process.stdin.write(`${JSON.stringify({ id: 'shutdown', op: 'shutdown' })}\n`);
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      bridge.process.kill();
    } catch {
      // already gone
    }
  }, 400).unref?.();
}

export function disposeAllNotebooks(): void {
  for (const notebookPath of [...bridges.keys()]) disposeNotebook(notebookPath);
}

export function registerNotebookIpc(): void {
  ipcMain.handle('nb:open', (_event, notebookPath: string) => openNotebook(notebookPath));
  ipcMain.handle('nb:save', (_event, data: NotebookData) => saveNotebook(data));
  ipcMain.handle('nb:execute', (event, notebookPath: string, code: string, token?: string) =>
    executeNotebook(notebookPath, code, token, event.sender),
  );
  ipcMain.handle('nb:restart', (_event, notebookPath: string) =>
    restartNotebookKernel(notebookPath),
  );
  ipcMain.handle('nb:interrupt', (_event, notebookPath: string) =>
    interruptNotebookKernel(notebookPath),
  );
  ipcMain.handle('nb:status', (_event, notebookPath: string) => notebookStatus(notebookPath));
  ipcMain.handle('nb:dispose', (_event, notebookPath: string) => disposeNotebook(notebookPath));
}
