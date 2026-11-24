import {
  LineFramer,
  RpcErrorCode,
  encodeMessage,
  failure,
  notification,
  parseMessage,
  success,
  type JsonRpcId,
  type JsonRpcMessage,
} from './protocol.ts';

/**
 * The daemon's RPC server.
 *
 * Designed for the thing the desktop runtime could not do: **many requests in
 * flight at once**. Every request gets its own entry and its own `AbortSignal`,
 * so N agents stream concurrently without serialising behind one another or
 * behind the transport.
 *
 * A handler may answer immediately or run for minutes; either way the transport
 * stays readable, because dispatch is fire-and-forget rather than awaited.
 */

export interface MessageWriter {
  write(chunk: string): boolean;
  once?(event: 'drain', listener: () => void): unknown;
}

export interface RequestContext {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly signal: AbortSignal;
  /** True until the request has been answered. */
  readonly pending: boolean;
  /** Notifications for this request only; multiplexed onto one wire. */
  stream(method: string, params: unknown): void;
  notify(method: string, params?: unknown): void;
}

export type Handler = (params: unknown, context: RequestContext) => unknown | Promise<unknown>;

export interface RpcServerOptions {
  input: NodeJS.ReadableStream;
  output: MessageWriter;
  /** Reports handler failures for logging; never throws into the transport. */
  onError?: (error: Error, method: string) => void;
  /** Optional tracing of every outbound message; used by the tests and --log. */
  onOutbound?: (message: JsonRpcMessage) => void;
}

interface InFlight {
  controller: AbortController;
  answered: boolean;
}

export class RpcServer {
  private readonly handlers = new Map<string, Handler>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly framer = new LineFramer();
  private closed = false;
  private readonly options: RpcServerOptions;

  // A parameter property (`constructor(private readonly options: …)`) is not
  // supported by Node's strip-only TypeScript loader, which the daemon relies on.
  constructor(options: RpcServerOptions) {
    this.options = options;
  }

  /** Registers a method. Throws on duplicates so a typo cannot shadow a real one. */
  register(method: string, handler: Handler): void {
    if (this.handlers.has(method)) {
      throw new Error(`Duplicate RPC method registration: ${method}`);
    }
    this.handlers.set(method, handler);
  }

  get registeredMethods(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** Number of requests currently running; the daemon reports this as its load. */
  get pendingCount(): number {
    return [...this.inFlight.values()].filter((entry) => !entry.answered).length;
  }

  listen(): void {
    this.options.input.setEncoding?.('utf8');
    this.options.input.on('data', (chunk: string | Buffer) => {
      this.consume(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    this.options.input.on('end', () => this.dispose('client disconnected'));
    this.options.input.on('close', () => this.dispose('client disconnected'));
    this.options.input.on('error', () => this.dispose('transport error'));
  }

  /** Aborts every in-flight request and stops reading. Idempotent. */
  dispose(reason = 'server disposed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.inFlight.values()) {
      if (!entry.controller.signal.aborted) entry.controller.abort(new Error(reason));
    }
    this.inFlight.clear();
  }

  private consume(chunk: string): void {
    if (this.closed) return;
    for (const line of this.framer.push(chunk)) {
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage | null;
    try {
      message = parseMessage(line);
    } catch (error) {
      this.write(
        failure(null, RpcErrorCode.ParseError, (error as Error)?.message || 'Invalid JSON'),
      );
      return;
    }
    if (!message) return;

    // Responses are not expected from a client, but tolerate them rather than
    // treating a well-formed message as a protocol violation.
    if ('result' in message || 'error' in message) return;
    if (!('id' in message)) {
      // A client notification. None are defined yet; ignore rather than fail,
      // so a future client can add fire-and-forget calls without a version bump.
      return;
    }
    void this.dispatch(message.id, message.method, message.params);
  }

  private async dispatch(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const key = String(id);
    if (this.inFlight.has(key)) {
      this.write(
        failure(id, RpcErrorCode.InvalidRequest, `A request with id ${key} is already running.`),
      );
      return;
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      this.write(failure(id, RpcErrorCode.MethodNotFound, `Unknown method: ${method}`));
      return;
    }

    const entry: InFlight = { controller: new AbortController(), answered: false };
    this.inFlight.set(key, entry);

    const settle = (message: JsonRpcMessage): void => {
      if (entry.answered) return;
      entry.answered = true;
      this.inFlight.delete(key);
      this.write(message);
    };

    const context: RequestContext = {
      id,
      method,
      signal: entry.controller.signal,
      get pending() {
        return !entry.answered;
      },
      stream: (streamMethod, streamParams) => {
        // Deliberately does NOT consult `entry.answered`. A streamed request is
        // acknowledged immediately and is expected to keep emitting notifications
        // long after that response is written; gating on `answered` here silently
        // discarded every delta. `answered` exists only to stop a second
        // *response* — and `settle()` is the sole writer of responses.
        if (this.closed) return;
        this.write(notification(streamMethod, streamParams));
      },
      notify: (notifyMethod, notifyParams) => {
        if (this.closed) return;
        this.write(notification(notifyMethod, notifyParams));
      },
    };

    try {
      const result = await handler(params, context);
      settle(success(id, result));
    } catch (error) {
      const message = (error as Error)?.message || 'Handler failed';
      this.options.onError?.(
        error instanceof Error ? error : new Error(message),
        method,
      );
      const code =
        (error as { rpcCode?: number })?.rpcCode ??
        (entry.controller.signal.aborted ? RpcErrorCode.Cancelled : RpcErrorCode.InternalError);
      settle(failure(id, code, message));
    }
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) return;
    try {
      this.options.output.write(encodeMessage(message));
      this.options.onOutbound?.(message);
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
        '<transport>',
      );
      this.dispose('write failed');
    }
  }
}
