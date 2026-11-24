import type { Readable, Writable } from 'node:stream';

/**
 * JSON-RPC 2.0 over stdio with LSP Content-Length framing, used to talk to the
 * GitHub Copilot language server. Electron-free so tests can drive it with a
 * mock server.
 */

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

type NotificationHandler = (method: string, params: unknown) => void;
type RequestHandler = (
  method: string,
  params: unknown,
) => { result?: unknown } | { error: { code: number; message: string } } | undefined;

export class CopilotConnection {
  private input: Writable | null = null;
  private output: Readable | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposed = false;
  private notificationHandler: NotificationHandler | null = null;
  private requestHandler: RequestHandler | null = null;

  get connected(): boolean {
    return Boolean(this.input && !this.input.destroyed && !this.disposed);
  }

  attachStdio(input: Writable, output: Readable): void {
    this.input = input;
    this.output = output;
    output.on('data', (chunk: Buffer) => this.consume(chunk));
    output.on('close', () => this.failAll(new Error('The Copilot server disconnected.')));
    output.on('error', (error: Error) => this.failAll(error));
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('The Copilot language server is not running.'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Copilot request "${method}" timed out.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new Error('The Copilot session ended.'));
    try {
      this.input?.end();
    } catch {
      // ignore
    }
    this.input = null;
    this.output = null;
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ]);
    try {
      if (this.input && !this.input.destroyed) this.input.write(frame);
    } catch {
      // pending request timeout reports the failure
    }
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      const bodyStart = headerEnd + 4;
      if (!match) {
        this.buffer = this.buffer.subarray(bodyStart);
        continue;
      }
      const length = Number(match[1]);
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
    const method = typeof message.method === 'string' ? message.method : '';
    const id = message.id;
    if (id !== undefined && !method) {
      const pending = this.pending.get(Number(id));
      if (!pending) return;
      this.pending.delete(Number(id));
      clearTimeout(pending.timer);
      const error = message.error as Record<string, unknown> | undefined;
      if (error) {
        pending.reject(new Error(String(error.message || 'Copilot request failed.')));
        return;
      }
      pending.resolve(message.result ?? null);
      return;
    }
    if (method && id !== undefined) {
      const answer = this.requestHandler?.(method, message.params) ?? {
        result: null,
      };
      if ('id' in (answer as object) && answer === undefined) return;
      this.write({ jsonrpc: '2.0', id, ...answer });
      return;
    }
    if (method) {
      this.notificationHandler?.(method, message.params);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
