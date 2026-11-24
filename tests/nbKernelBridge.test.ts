import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'electron',
  'nbKernelBridge.py',
);

interface BridgeMessage {
  id?: string;
  ready?: boolean;
  ok?: boolean;
  error?: string;
  kernel?: string;
  pandas?: boolean;
  outputs?: Array<Record<string, unknown>>;
  dataframes?: Record<string, unknown>;
  token?: string;
  partial?: Record<string, unknown>;
}

class BridgeHarness {
  process: ChildProcessWithoutNullStreams;
  ready: Promise<BridgeMessage>;
  partials: BridgeMessage[] = [];
  private pending = new Map<string, (message: BridgeMessage) => void>();
  private readyResolve!: (message: BridgeMessage) => void;

  constructor() {
    this.process = spawn('python', ['-u', bridgeScript], {
      cwd: path.dirname(bridgeScript),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.ready = new Promise<BridgeMessage>((resolve) => {
      this.readyResolve = resolve;
    });
    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let message: BridgeMessage;
      try {
        message = JSON.parse(line) as BridgeMessage;
      } catch {
        return;
      }
      if (message.ready) {
        this.readyResolve(message);
        return;
      }
      if (message.partial !== undefined && message.id) {
        this.partials.push(message);
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    });
  }

  request(payload: Record<string, unknown>, timeoutMs = 120_000): Promise<BridgeMessage> {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise<BridgeMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Bridge request timed out'));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.process.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    });
  }

  dispose(): void {
    try {
      this.process.stdin.write(`${JSON.stringify({ id: 'shutdown', op: 'shutdown' })}\n`);
    } catch {
      // ignore
    }
    setTimeout(() => this.process.kill(), 500);
  }
}

test('notebook bridge interrupt stops a running cell', { timeout: 180_000 }, async (t) => {
  let harness: BridgeHarness;
  try {
    harness = new BridgeHarness();
  } catch (error) {
    t.skip(`python unavailable: ${(error as Error).message}`);
    return;
  }
  try {
    await Promise.race([
      harness.ready,
      new Promise<BridgeMessage>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bridge ready timeout')), 120_000);
        timer.unref?.();
      }),
    ]);
    const pending = harness.request({
      op: 'execute',
      code: "import time\nprint('before sleep')\ntime.sleep(20)",
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const interrupt = await harness.request({ op: 'interrupt' }, 20_000);
    assert.equal(interrupt.ok, true);
    // The pending execute settles quickly (possibly as an error because its
    // kernel was killed) instead of running for the full sleep.
    await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('cell did not stop after interrupt')), 20_000),
      ),
    ]);
    // The next execute boots a fresh kernel.
    const after = await harness.request({ op: 'execute', code: 'print("after interrupt")' });
    assert.equal(after.ok, true, after.error);
    const text = (after.outputs || [])
      .map((output) => String(output.text || ''))
      .join('');
    assert.match(text, /after interrupt/);
  } finally {
    harness.dispose();
  }
});

test('streams partial outputs while a cell is still running', { timeout: 180_000 }, async (t) => {
  let harness: BridgeHarness;
  try {
    harness = new BridgeHarness();
  } catch (error) {
    t.skip(`python unavailable: ${(error as Error).message}`);
    return;
  }
  try {
    await Promise.race([
      harness.ready,
      new Promise<BridgeMessage>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bridge ready timeout')), 120_000);
        timer.unref?.();
      }),
    ]);
    const pending = harness.request({
      op: 'execute',
      token: 'cell-1',
      code:
        "import time\n" +
        "for _i in range(3):\n" +
        "    print('tick', _i, flush=True)\n" +
        "    time.sleep(0.5)\n",
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const partials = harness.partials.filter(
      (message) => message.token === 'cell-1' && message.partial,
    );
    assert.ok(partials.length > 0, 'expected live partial outputs before completion');
    const streamedText = partials
      .map((message) => String(message.partial?.text || ''))
      .join('');
    assert.match(streamedText, /tick/);

    const result = await pending;
    assert.equal(result.ok, true, result.error);
    const finalText = (result.outputs || [])
      .map((output) => String(output.text || ''))
      .join('');
    assert.match(finalText, /tick 2/);
  } finally {
    harness.dispose();
  }
});

test('notebook bridge boots a kernel, executes code and snapshots DataFrames', { timeout: 180_000 }, async (t) => {
  if (process.platform !== 'win32' && !process.env.PATH?.includes('python')) {
    // On non-Windows setups python may be named python3; still try and skip on failure.
  }
  let harness: BridgeHarness;
  try {
    harness = new BridgeHarness();
  } catch (error) {
    t.skip(`python unavailable: ${(error as Error).message}`);
    return;
  }
  try {
    const readyTimer = setTimeout(() => undefined, 120_000);
    const ready = await Promise.race([
      harness.ready,
      new Promise<BridgeMessage>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('bridge ready timeout')), 120_000);
        timer.unref?.();
      }),
    ]);
    clearTimeout(readyTimer);
    assert.equal(ready.ready, true);
    if (!ready.pandas) {
      t.skip('pandas is not available to the bridge python');
      return;
    }

    const result = await harness.request({
      op: 'execute',
      code:
        "import pandas as pd\n" +
        "df = pd.DataFrame({'actor': ['A', 'B', 'C'], 'score': [7.5, 8.0, 6.5]})\n" +
        "df",
    });
    assert.equal(result.ok, true, result.error);
    const outputs = result.outputs || [];
    assert.ok(outputs.length >= 1);
    const hasResult = outputs.some((output) => output.type === 'result');
    assert.equal(hasResult, true);

    const frames = result.dataframes as Record<string, {
      columns: Array<{ name: string; dtype: string }>;
      rows: unknown[][];
      shape: number[];
    }>;
    assert.ok(frames.df, 'expected a df snapshot');
    assert.deepEqual(
      frames.df.columns.map((column) => column.name),
      ['actor', 'score'],
    );
    assert.deepEqual(frames.df.shape, [3, 2]);
    assert.equal(frames.df.rows.length, 3);
    assert.equal(frames.df.rows[0][1], 7.5);

    const error = await harness.request({ op: 'execute', code: 'raise ValueError("boom")' });
    assert.equal(error.ok, true);
    const errorOutput = (error.outputs || []).find((output) => output.type === 'error');
    assert.ok(errorOutput, 'expected an error output');
    assert.match(String(errorOutput?.evalue), /boom/);
  } finally {
    harness.dispose();
  }
});
