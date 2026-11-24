import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DAEMON_ENTRY = path.join(here, '..', '..', 'agentd', 'src', 'main.ts');
export const MOCK_PROVIDER = path.join(here, '..', 'fixtures', 'mock-sse-provider.mjs');

/** Starts the mock provider and resolves with its base URL and a stop handle. */
export async function startMockProvider(
  query = '',
): Promise<{ baseUrl: string; stop(): void }> {
  const child = spawn(process.execPath, [MOCK_PROVIDER], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise<number>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('mock provider did not start')), 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const match = /LISTENING (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const suffix = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return {
    baseUrl: `http://127.0.0.1:${port}/v1${suffix}`,
    stop: () => child.kill(),
  };
}

export interface Received {
  method: string;
  params: any;
}

/**
 * Drives the daemon over real stdio: spawns it, writes JSON-RPC lines, and records
 * every message plus the raw output for diagnostics. The daemon is exercised as a
 * separate process, because that is the only way to test that it survives and
 * behaves across the process boundary.
 */
export class DaemonHarness {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  readonly received: Received[] = [];
  readonly rawOutput: string[] = [];
  readonly stderr: string[] = [];

  async start(entry = DAEMON_ENTRY): Promise<void> {
    this.child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => {
      this.rawOutput.push(chunk);
      this.consume(chunk);
    });
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (chunk: string) => this.stderr.push(chunk));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method) {
        this.received.push({ method: message.method, params: message.params });
        continue;
      }
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  }

  /** Sends a request and resolves with its result (or rejects with its error). */
  call(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(payload);
    });
  }

  /** Sends a request without waiting, for concurrency tests. */
  callNoWait(method: string, params?: unknown): number {
    const id = this.nextId++;
    this.child!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return id;
  }

  notifications(method?: string): Received[] {
    return method ? this.received.filter((entry) => entry.method === method) : this.received;
  }

  /** Waits until `predicate` holds, or throws after `timeoutMs`. */
  async waitFor(predicate: () => boolean, timeoutMs = 15_000, label = 'condition'): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Timed out waiting for ${label}. Received: ${JSON.stringify(
        this.received.slice(-8),
      )} stderr: ${this.stderr.join('').slice(-400)}`,
    );
  }

  close(): void {
    this.child?.kill();
    this.child = null;
  }
}
