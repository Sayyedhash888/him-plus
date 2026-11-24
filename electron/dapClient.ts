import net from 'node:net';
import type { Readable, Writable } from 'node:stream';

/**
 * Minimal Debug Adapter Protocol client. Supports TCP (remote/attach) and stdio
 * (spawned adapter such as `python -m debugpy.adapter`) transports. Electron-free
 * so node:test can exercise it against a mock adapter.
 */

export interface DapClientOptions {
  onEvent?(event: string, body: unknown): void;
  onLog?(line: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class DapClient {
  private socket: net.Socket | null = null;
  private input: Writable | null = null;
  private output: Readable | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventWaiters = new Map<string, Array<() => void>>();
  private disposed = false;
  private readonly options: DapClientOptions;

  constructor(options: DapClientOptions = {}) {
    this.options = options;
  }

  get connected(): boolean {
    if (this.disposed) return false;
    if (this.input) return !this.input.destroyed;
    return Boolean(this.socket && !this.socket.destroyed);
  }

  /** Connects a spawned adapter whose DAP channel is its stdin/stdout. */
  attachStdio(input: Writable, output: Readable): void {
    this.input = input;
    this.output = output;
    output.on('data', (chunk: Buffer) => this.consume(chunk));
    output.on('error', (error: Error) => this.options.onLog?.(error.message));
    output.on('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('The debug adapter disconnected.'));
      }
      this.pending.clear();
    });
  }

  connect(host: string, port: number, timeoutMs = 20_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Timed out connecting to the debug adapter.'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        this.attach(socket);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  request(command: string, args: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('The debug adapter is not connected.'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Debug request "${command}" timed out.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ seq: id, type: 'request', command, arguments: args });
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The debug session ended.'));
    }
    this.pending.clear();
    try {
      this.socket?.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
    try {
      this.input?.end();
    } catch {
      // ignore
    }
    this.input = null;
    this.output = null;
  }

  private attach(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => this.consume(chunk));
    socket.on('error', (error) => this.options.onLog?.(error.message));
    socket.on('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('The debug adapter disconnected.'));
      }
      this.pending.clear();
    });
  }

  /** Resolves when the adapter emits an event with this name (or times out). */
  waitForEvent(name: string, timeoutMs = 10_000): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(name) || [];
        this.eventWaiters.set(
          name,
          waiters.filter((waiter) => waiter !== done),
        );
        resolve();
      }, timeoutMs);
      timer.unref?.();
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const waiters = this.eventWaiters.get(name) || [];
      waiters.push(done);
      this.eventWaiters.set(name, waiters);
    });
  }

  private send(payload: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ]);
    try {
      if (this.input && !this.input.destroyed) {
        this.input.write(frame);
        return;
      }
      if (this.socket && !this.socket.destroyed) this.socket.write(frame);
    } catch {
      // The pending request will time out or be rejected on disconnect.
    }
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header);
      const bodyStart = headerEnd + 4;
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(bodyStart);
        continue;
      }
      const length = Number(lengthMatch[1]);
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // ignore malformed frames
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type;
    if (type === 'response') {
      const requestSeq = Number(message.request_seq);
      const pending = this.pending.get(requestSeq);
      if (!pending) return;
      this.pending.delete(requestSeq);
      clearTimeout(pending.timer);
      if (message.success === false) {
        pending.reject(new Error(String(message.message || 'Debug request failed.')));
        return;
      }
      pending.resolve(message.body ?? {});
      return;
    }
    if (type === 'event') {
      const event = typeof message.event === 'string' ? message.event : '';
      if (event) {
        const waiters = this.eventWaiters.get(event);
        if (waiters && waiters.length > 0) {
          this.eventWaiters.set(event, []);
          for (const waiter of waiters) waiter();
        }
        this.options.onEvent?.(event, message.body ?? {});
      }
      return;
    }
    if (type === 'request') {
      // Minimal reverse-request handling: runInTerminal / startDebugging are unsupported.
      const seq = Number(message.seq);
      this.send({
        seq: this.nextId++,
        type: 'response',
        request_seq: seq,
        success: false,
        command: message.command,
        message: 'Not supported by HIM+.',
      });
    }
  }
}
