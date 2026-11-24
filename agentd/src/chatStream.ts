/**
 * Transport-agnostic chat streaming for OpenAI-compatible providers.
 *
 * Ported from `electron/llm.ts`, which was correct but welded to Electron: it took
 * an `IpcMainInvokeEvent` and pushed events at `event.sender`. Here the event sink
 * is a parameter, so the same engine runs in the daemon, in the desktop main
 * process, or in a plain `node:test`.
 *
 * The behaviours below are deliberate and were preserved verbatim, because each
 * one fixes a real failure mode:
 *
 * - **Never retry after emitting a delta.** A retry past the first token would
 *   duplicate content in the transcript.
 * - **Separate header and idle timeouts.** A provider that accepts the connection
 *   and then stalls is not the same failure as one that never answers.
 * - **Distinguish our own timer aborts from user aborts**, so a timeout is reported
 *   as a timeout rather than as a cancellation.
 * - **Honour `Retry-After`**, capped, before falling back to the fixed backoff.
 */

const MAX_CHAT_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 2000] as const;
const MAX_RETRY_AFTER_MS = 15_000;
const HEADER_TIMEOUT_MS = 120_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MESSAGE = 'The provider stopped streaming for more than 90 seconds.';
const HEADER_TIMEOUT_MESSAGE = 'The provider did not respond within 120 seconds.';
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_PATTERN =
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i;

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
}

export interface LlmToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  /** Argument fragments arrive incrementally and are concatenated by `index`. */
  arguments?: string;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

export type ChatStreamEvent =
  | {
      type: 'delta';
      content?: string;
      reasoning?: string;
      toolCalls?: LlmToolCallDelta[];
      usage?: LlmUsage;
    }
  | { type: 'done'; usage?: LlmUsage; finishReason?: string | null }
  | { type: 'error'; message: string; aborted?: boolean };

export interface ChatStreamRequest {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  messages: LlmChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatStreamOptions {
  signal: AbortSignal;
  onEvent(event: ChatStreamEvent): void;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; shortens the 120s/90s timers. */
  timeouts?: { headerMs?: number; idleMs?: number };
}

class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function trimBase(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Provider base URL is empty.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid provider base URL: ${trimmed}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider base URL must use http or https.');
  }
  return trimmed;
}

/**
 * Derives the chat-completions URL from a provider base.
 *
 * Uses the URL API rather than string concatenation: appending a path to a base
 * that already carries a query string (`…/v1?api-version=…`, common on Azure and
 * custom gateways) would otherwise splice the path into the query and send a
 * request to the wrong place.
 */
export function chatEndpoint(baseUrl: string): string {
  const trimmed = trimBase(baseUrl);
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) {
    // normalise duplicate slashes without touching the query
    url.pathname = path;
    return url.toString();
  }
  url.pathname = path.endsWith('/completions')
    ? `${path.slice(0, -'/completions'.length)}/chat/completions`
    : `${path}/chat/completions`;
  return url.toString();
}

export function buildHeaders(
  apiKey: string | undefined,
  custom: Record<string, string> | undefined,
  accept: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: accept,
  };
  if (apiKey && apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  for (const [key, value] of Object.entries(custom || {})) {
    if (!key.trim()) continue;
    if (!value || typeof value !== 'string') continue;
    // Fold every case variant onto the canonical name. Writing the caller's
    // spelling verbatim would leave `Authorization` *and* `authorization` both
    // present when an apiKey is also set, and a case-sensitive server could read
    // the stale one.
    if (key.toLowerCase() === 'authorization') {
      headers.Authorization = value;
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

/** Providers differ on key casing (`prompt_tokens` vs `promptTokens`). */
export function normalizeUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const pick = (snake: string, camel: string): number | undefined =>
    typeof record[snake] === 'number'
      ? (record[snake] as number)
      : typeof record[camel] === 'number'
        ? (record[camel] as number)
        : undefined;
  const promptTokens = pick('prompt_tokens', 'promptTokens');
  const completionTokens = pick('completion_tokens', 'completionTokens');
  const totalTokens = pick('total_tokens', 'totalTokens');
  const cost =
    typeof record.cost === 'number'
      ? record.cost
      : typeof record.total_cost === 'number'
        ? record.total_cost
        : undefined;
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    cost === undefined
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens, cost };
}

export function extractToolDeltas(delta: unknown): LlmToolCallDelta[] | undefined {
  const source = delta as { tool_calls?: unknown; function_call?: unknown } | null;
  const result: LlmToolCallDelta[] = [];
  if (Array.isArray(source?.tool_calls)) {
    source.tool_calls.forEach((call: unknown, index: number) => {
      if (!call || typeof call !== 'object') return;
      const entry = call as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const deltaEntry: LlmToolCallDelta = {
        index: typeof entry.index === 'number' ? entry.index : index,
      };
      if (typeof entry.id === 'string' && entry.id) deltaEntry.id = entry.id;
      if (entry.function && typeof entry.function === 'object') {
        if (typeof entry.function.name === 'string' && entry.function.name) {
          deltaEntry.name = entry.function.name;
        }
        if (typeof entry.function.arguments === 'string') {
          deltaEntry.arguments = entry.function.arguments;
        } else if (entry.function.arguments && typeof entry.function.arguments === 'object') {
          deltaEntry.arguments = JSON.stringify(entry.function.arguments);
        }
      }
      result.push(deltaEntry);
    });
  } else if (source?.function_call && typeof source.function_call === 'object') {
    const legacy = source.function_call as { name?: unknown; arguments?: unknown };
    const entry: LlmToolCallDelta = { index: 0 };
    if (typeof legacy.name === 'string') entry.name = legacy.name;
    if (typeof legacy.arguments === 'string') entry.arguments = legacy.arguments;
    result.push(entry);
  }
  return result.length ? result : undefined;
}

/** Text may arrive as a string or as an array of `{ type, text }` parts. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const record = part as { text?: unknown; content?: unknown };
          if (typeof record.text === 'string') return record.text;
          if (typeof record.content === 'string') return record.content;
        }
        return '';
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    const record = value as { text?: unknown; content?: unknown };
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return '';
}

/** Parses `Retry-After` as delta-seconds or an HTTP date; only positive values count. */
export function parseRetryAfterMs(raw: string | null): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) return null;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  const delta = date - Date.now();
  if (delta <= 0) return null;
  return Math.min(delta, MAX_RETRY_AFTER_MS);
}

export function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) return retryAfterMs;
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

/**
 * Splits an SSE byte stream into `data:` payloads and dispatches each complete
 * event. Comment lines (`:`) are ignored; multi-line `data:` fields join with
 * newlines, per the SSE spec.
 */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onPayload: (payload: string) => void,
  onIdle: () => void,
  idleMs: number,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, idleMs);
  };
  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };
  const flush = () => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    onPayload(payload);
  };

  try {
    for (;;) {
      armIdleTimer();
      const { done, value } = await reader.read().finally(clearIdleTimer);
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        let line = rawLine;
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          flush();
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
          continue;
        }
        // event:, id:, retry: and unknown fields are not needed for chat deltas.
      }
    }
    // A stream that ends without a trailing blank line still has a pending event.
    buffer += decoder.decode();
    if (buffer) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    flush();
  } finally {
    clearIdleTimer();
    reader.releaseLock();
  }
}

function isTransientNetworkError(error: unknown): boolean {
  const message = (error as Error)?.message || '';
  return TRANSIENT_NETWORK_PATTERN.test(message);
}

/**
 * Streams one chat completion, invoking `onEvent` for each delta and exactly one
 * terminal `done` or `error`.
 *
 * Resolves when the stream terminates. Callers that need to answer a request
 * before the stream ends should acknowledge first and treat `onEvent` as the
 * completion signal — see `agentd/ARCHITECTURE.md` on why `llm.start` should
 * resolve at stream *start* rather than at stream end.
 */
export async function streamChat(
  request: ChatStreamRequest,
  options: ChatStreamOptions,
): Promise<void> {
  const { signal, onEvent } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headerMs = options.timeouts?.headerMs ?? HEADER_TIMEOUT_MS;
  const idleMs = options.timeouts?.idleMs ?? STREAM_IDLE_TIMEOUT_MS;

  if (!request || typeof request.model !== 'string' || !request.model.trim()) {
    throw new Error('No model selected.');
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error('Chat request has no messages.');
  }

  const url = chatEndpoint(request.baseUrl);
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
  };
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
    body.tool_choice = 'auto';
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  if (typeof request.maxTokens === 'number' && request.maxTokens > 0) {
    body.max_tokens = request.maxTokens;
  }

  let usage: LlmUsage | undefined;
  let finishReason: string | null = null;
  let emittedPayload = false;
  let finished = false;

  const sendDone = () => {
    if (finished) return;
    finished = true;
    onEvent({ type: 'done', usage, finishReason });
  };

  const handlePayload = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed) return;
    if (trimmed === '[DONE]') {
      sendDone();
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return;
    }
    const record = json as {
      error?: unknown;
      usage?: unknown;
      choices?: unknown[];
      data?: unknown[];
      delta?: unknown;
    };
    if (record?.error) {
      const error = record.error;
      const message =
        typeof error === 'string'
          ? error
          : ((error as { message?: string })?.message ?? 'stream error');
      throw new Error(`Provider stream error: ${message}`);
    }
    const candidateUsage = normalizeUsage(record?.usage);
    if (candidateUsage) usage = { ...usage, ...candidateUsage };

    const choice = (record?.choices?.[0] ?? record?.data?.[0]) as
      | { delta?: unknown; message?: unknown; finish_reason?: unknown }
      | undefined;
    const delta = (choice?.delta ?? choice?.message ?? record?.delta) as
      | Record<string, unknown>
      | undefined;
    if (!delta && !choice) return;

    const content = textOf(delta?.content);
    const reasoning = textOf(delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking);
    const toolCalls = extractToolDeltas(delta);
    if (content || reasoning || toolCalls) {
      emittedPayload = true;
      onEvent({
        type: 'delta',
        content: content || undefined,
        reasoning: reasoning || undefined,
        toolCalls,
        usage: candidateUsage,
      });
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    else if (choice?.finish_reason === null) finishReason = null;
  };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    let abortReason: 'user' | 'header-timeout' | 'idle-timeout' | null = null;

    const abortForTimeout = (reason: 'header-timeout' | 'idle-timeout') => {
      if (controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const onExternalAbort = () => {
      if (!abortReason) abortReason = 'user';
      if (!controller.signal.aborted) controller.abort();
    };
    signal.addEventListener('abort', onExternalAbort, { once: true });
    if (signal.aborted) onExternalAbort();

    const headerTimer = setTimeout(() => abortForTimeout('header-timeout'), headerMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: buildHeaders(request.apiKey, request.headers, 'text/event-stream'),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(headerTimer);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ProviderHttpError(
          `Provider request failed (HTTP ${response.status}): ${
            errorText.trim().slice(0, 500) || response.statusText
          }`,
          response.status,
          parseRetryAfterMs(response.headers.get('retry-after')),
        );
      }
      if (!response.body) throw new Error('Provider returned an empty response body.');

      await consumeSse(
        response.body,
        handlePayload,
        () => abortForTimeout('idle-timeout'),
        idleMs,
      );
      sendDone();
      return;
    } catch (error) {
      const aborted = controller.signal.aborted;
      if (aborted && abortReason === 'user') {
        if (!finished) {
          finished = true;
          onEvent({ type: 'error', message: 'Request aborted.', aborted: true });
        }
        return;
      }
      if (aborted && abortReason === 'idle-timeout') {
        lastError = new Error(IDLE_TIMEOUT_MESSAGE);
      } else if (aborted && abortReason === 'header-timeout') {
        lastError = new Error(HEADER_TIMEOUT_MESSAGE);
      } else {
        lastError = error;
      }

      let retryable = false;
      let retryAfter: number | null = null;
      if (lastError instanceof ProviderHttpError) {
        retryable = RETRYABLE_HTTP_STATUSES.has(lastError.status);
        retryAfter = lastError.retryAfterMs;
      } else if (!aborted) {
        retryable = isTransientNetworkError(lastError);
      }

      // A retry after any delta would duplicate transcript content.
      const timedOut = abortReason === 'idle-timeout' || abortReason === 'header-timeout';
      if (!retryable || emittedPayload || timedOut || attempt >= MAX_CHAT_ATTEMPTS) {
        if (!finished) {
          finished = true;
          onEvent({
            type: 'error',
            message: (lastError as Error)?.message || 'unknown error',
          });
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, retryAfter)));
    } finally {
      clearTimeout(headerTimer);
      signal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (!finished) {
    finished = true;
    onEvent({
      type: 'error',
      message: (lastError as Error)?.message || 'The request failed.',
    });
  }
}
