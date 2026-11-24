/**
 * Minimal JSON-RPC 2.0 framing for the HIM+ agent daemon.
 *
 * The daemon speaks line-delimited JSON-RPC 2.0 over stdio. Streaming is modelled
 * as server→client *notifications* rather than a second protocol, because the
 * existing payload types (`LlmStreamEvent`, `AcpStreamEvent`, …) already carry
 * their own correlation key and a `type` discriminator:
 *
 *   {"jsonrpc":"2.0","method":"stream.llm","params":{"requestId":"…","type":"delta",…}}
 *
 * Two rules the rest of the daemon depends on:
 *
 * 1. Every stream terminates with exactly one `done` or `error` notification.
 *    `electron/llm.ts` already guaranteed this; a client may not have to guess.
 * 2. Requests are answered exactly once. `respond()` is idempotent per id, so a
 *    handler that streams for minutes and then replies cannot double-answer.
 */

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

/** Standard JSON-RPC error codes, plus the two the daemon needs of its own. */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** The handler streamed a terminal error before replying. */
  StreamFailed: -32000,
  /** The client is gone; the work was cancelled. */
  Cancelled: -32001,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

/**
 * Parses one line into a message. Returns `null` for a blank line, and throws for
 * anything that is not valid JSON-RPC so the caller can answer with a parse error
 * when an id is recoverable.
 */
export function parseMessage(line: string): JsonRpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed: unknown = JSON.parse(trimmed);
  if (!isRecord(parsed)) throw new Error('JSON-RPC message must be an object.');

  const hasId = isId(parsed.id);
  const method = parsed.method;
  const hasResult = 'result' in parsed;
  const hasError = 'error' in parsed;

  if (typeof method === 'string') {
    if (hasId) {
      return {
        jsonrpc: '2.0',
        id: parsed.id as JsonRpcId,
        method,
        params: parsed.params,
      } satisfies JsonRpcRequest;
    }
    return { jsonrpc: '2.0', method, params: parsed.params } satisfies JsonRpcNotification;
  }
  if (hasError) {
    const error = parsed.error;
    if (!isRecord(error) || typeof error.message !== 'string') {
      throw new Error('JSON-RPC error member must carry a message.');
    }
    return {
      jsonrpc: '2.0',
      id: hasId ? (parsed.id as JsonRpcId) : null,
      error: {
        code: typeof error.code === 'number' ? error.code : RpcErrorCode.InternalError,
        message: error.message,
        data: error.data,
      },
    } satisfies JsonRpcFailure;
  }
  if (hasResult) {
    return {
      jsonrpc: '2.0',
      id: hasId ? (parsed.id as JsonRpcId) : null,
      result: parsed.result,
    } satisfies JsonRpcSuccess;
  }
  throw new Error('JSON-RPC message has neither method, result nor error.');
}

export function encodeMessage(message: JsonRpcMessage): string {
  // JSON.stringify escapes newlines inside strings, so one message is one line.
  return `${JSON.stringify(message)}\n`;
}

export function success(id: JsonRpcId | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result: result === undefined ? null : result };
}

export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function notification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) };
}

/**
 * Splits a byte stream into JSON-RPC lines. Node's `readline` would do, but this
 * keeps the framing testable without a subprocess and gives the caller control
 * over partial-line flushing when a client disconnects mid-write.
 */
export class LineFramer {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // The trailing element is an incomplete line until a newline arrives.
    this.buffer = lines.pop() ?? '';
    return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }

  /** Returns any unterminated trailing line, e.g. at end of stream. */
  flush(): string | null {
    const rest = this.buffer;
    this.buffer = '';
    return rest.length ? rest : null;
  }
}
