import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type {
  FetchModelsInput,
  FetchModelsResult,
  LlmStartRequest,
  LlmStreamEvent,
  LlmUsage,
} from '../shared/types';

const controllers = new Map<string, AbortController>();

function trimBase(baseUrl: string): string {
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

function endpoint(baseUrl: string, kind: 'models' | 'chat'): string {
  // Derive the path with the URL API. Concatenating onto the raw base would splice
  // the path into the query string when the base already carries one, e.g.
  // "…/v1?api-version=1" + "/chat/completions" — sending the request to the wrong place.
  const url = new URL(trimBase(baseUrl));
  const path = url.pathname.replace(/\/+$/, '');
  if (kind === 'models') {
    if (path.endsWith('/chat/completions')) {
      url.pathname = `${path.slice(0, -'/chat/completions'.length)}/models`;
    } else if (path.endsWith('/completions')) {
      url.pathname = `${path.slice(0, -'/completions'.length)}/models`;
    } else {
      url.pathname = path.endsWith('/models') ? path : `${path}/models`;
    }
  } else if (path.endsWith('/chat/completions')) {
    url.pathname = path;
  } else if (path.endsWith('/completions')) {
    url.pathname = `${path.slice(0, -'/completions'.length)}/chat/completions`;
  } else {
    url.pathname = `${path}/chat/completions`;
  }
  return url.toString();
}

function buildHeaders(
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
    // Fold every case variant onto the canonical name: writing the caller's
    // spelling verbatim would leave `Authorization` and `authorization` both set
    // when an apiKey is present, and a case-sensitive server could read the stale one.
    if (key.toLowerCase() === 'authorization') {
      headers.Authorization = value;
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

async function fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  const url = endpoint(input.baseUrl, 'models');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(input.apiKey, input.headers, 'application/json'),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Model discovery failed (HTTP ${response.status}): ${text.trim().slice(0, 300) || 'empty response'}`,
      );
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Model discovery returned a non-JSON response.');
    }
    if (json?.error) {
      const message =
        typeof json.error === 'string' ? json.error : json.error?.message || 'unknown error';
      throw new Error(`Provider returned an error: ${message}`);
    }
    const rawItems = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : Array.isArray(json)
          ? json
          : [];
    const candidates: unknown[] = rawItems.map((item: any) => {
      if (typeof item === 'string') return item;
      return item?.id ?? item?.name ?? item?.model ?? item?.slug ?? null;
    });
    const ids: string[] = candidates
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
    const unique = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    return { models: unique };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Model discovery timed out after 30 seconds.');
    }
    const message = (error as Error)?.message || 'unknown error';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH/i.test(message)) {
      throw new Error(`Could not reach provider at ${url}. Check the base URL and network.`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.content === 'string') return part.content;
        return '';
      })
      .join('');
  }
  return '';
}

function normalizeUsage(raw: any): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const promptTokens =
    typeof raw.prompt_tokens === 'number'
      ? raw.prompt_tokens
      : typeof raw.promptTokens === 'number'
        ? raw.promptTokens
        : undefined;
  const completionTokens =
    typeof raw.completion_tokens === 'number'
      ? raw.completion_tokens
      : typeof raw.completionTokens === 'number'
        ? raw.completionTokens
        : undefined;
  const totalTokens =
    typeof raw.total_tokens === 'number'
      ? raw.total_tokens
      : typeof raw.totalTokens === 'number'
        ? raw.totalTokens
        : undefined;
  const cost =
    typeof raw.cost === 'number'
      ? raw.cost
      : typeof raw.total_cost === 'number'
        ? raw.total_cost
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

interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

function extractToolDeltas(delta: any): ToolCallDelta[] | undefined {
  const result: ToolCallDelta[] = [];
  if (Array.isArray(delta?.tool_calls)) {
    delta.tool_calls.forEach((call: any, index: number) => {
      if (!call || typeof call !== 'object') return;
      const entry: ToolCallDelta = {
        index: typeof call.index === 'number' ? call.index : index,
      };
      if (typeof call.id === 'string' && call.id) entry.id = call.id;
      if (call.function && typeof call.function === 'object') {
        if (typeof call.function.name === 'string' && call.function.name) {
          entry.name = call.function.name;
        }
        if (typeof call.function.arguments === 'string') {
          entry.arguments = call.function.arguments;
        } else if (call.function.arguments && typeof call.function.arguments === 'object') {
          entry.arguments = JSON.stringify(call.function.arguments);
        }
      }
      result.push(entry);
    });
  } else if (delta?.function_call && typeof delta.function_call === 'object') {
    const entry: ToolCallDelta = { index: 0 };
    if (typeof delta.function_call.name === 'string') entry.name = delta.function_call.name;
    if (typeof delta.function_call.arguments === 'string') {
      entry.arguments = delta.function_call.arguments;
    }
    result.push(entry);
  }
  return result.length ? result : undefined;
}

/** Chat streaming retry / timeout policy for OpenAI-compatible providers. */
const MAX_CHAT_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 2000] as const;
const MAX_RETRY_AFTER_MS = 15_000;
const HEADER_TIMEOUT_MS = 120_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const IDLE_TIMEOUT_MESSAGE = 'The provider stopped streaming for more than 90 seconds.';
const HEADER_TIMEOUT_MESSAGE = 'The provider did not respond within 120 seconds.';
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_PATTERN = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i;

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

/** Parses Retry-After as delta-seconds or an HTTP date; only positive values count. */
function parseRetryAfterMs(raw: string | null): number | null {
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

function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) return retryAfterMs;
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const text = [error.message, cause?.code, cause?.message].filter(Boolean).join(' ');
  return TRANSIENT_NETWORK_PATTERN.test(text);
}

/** Abort-aware backoff sleep so a user abort skips the remaining wait. */
function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) done();
  });
}

async function runChat(
  event: IpcMainInvokeEvent,
  request: LlmStartRequest,
): Promise<{ ok: boolean; error?: string }> {
  const sender = event.sender;
  if (!request || typeof request.requestId !== 'string' || !request.requestId) {
    throw new Error('Invalid chat request.');
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error('Chat request has no messages.');
  }
  if (typeof request.model !== 'string' || !request.model.trim()) {
    throw new Error('No model selected.');
  }
  if (controllers.has(request.requestId)) {
    throw new Error('A request with this ID is already running.');
  }

  const url = endpoint(request.baseUrl, 'chat');
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  let finished = false;
  let usage: LlmUsage | undefined;
  let finishReason: string | null = null;
  // True once a delta reached the renderer: a retry afterwards would duplicate content.
  let emittedPayload = false;
  // Distinguishes our own timeout aborts from a user abort on the same controller.
  let abortReason: 'user' | 'header-timeout' | 'idle-timeout' | null = null;

  const abortForTimeout = (reason: 'header-timeout' | 'idle-timeout') => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    controller.abort();
  };
  // The llm:abort IPC handler aborts the controller directly; any abort that did
  // not come from one of our timers is treated as a user abort.
  const handleExternalAbort = () => {
    if (!abortReason) abortReason = 'user';
  };
  controller.signal.addEventListener('abort', handleExternalAbort);

  const send = (payload: Omit<LlmStreamEvent, 'requestId'>) => {
    if (!sender.isDestroyed()) {
      sender.send('llm:event', { ...payload, requestId: request.requestId } as LlmStreamEvent);
    }
  };

  const sendDone = () => {
    if (finished) return;
    finished = true;
    send({ type: 'done', usage, finishReason });
  };

  const sendDelta = (payload: Omit<LlmStreamEvent, 'requestId'>) => {
    emittedPayload = true;
    send(payload);
  };

  const handlePayload = (payload: string, sendFn: (p: Omit<LlmStreamEvent, 'requestId'>) => void) => {
    const trimmedPayload = payload.trim();
    if (!trimmedPayload) return;
    if (trimmedPayload === '[DONE]') {
      sendDone();
      return;
    }
    let json: any;
    try {
      json = JSON.parse(trimmedPayload);
    } catch {
      return;
    }
    if (json?.error) {
      const message =
        typeof json.error === 'string' ? json.error : json.error?.message || 'stream error';
      throw new Error(`Provider stream error: ${message}`);
    }
    const candidateUsage = normalizeUsage(json?.usage);
    if (candidateUsage) usage = { ...usage, ...candidateUsage };

    const choice = json?.choices?.[0] ?? json?.data?.[0];
    const delta = choice?.delta ?? choice?.message ?? json?.delta;
    if (!delta && !choice) return;

    const content = textOf(delta?.content);
    const reasoning = textOf(
      delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking ?? null,
    );
    const toolCalls = extractToolDeltas(delta);
    if (content || reasoning || toolCalls) {
      sendFn({
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

  const streamAttempt = async (): Promise<void> => {
    const headerTimer = setTimeout(() => abortForTimeout('header-timeout'), HEADER_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
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
        `Provider request failed (HTTP ${response.status}): ${errorText.trim().slice(0, 500) || response.statusText}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (!response.body) {
      throw new Error('Provider returned an empty response body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        abortForTimeout('idle-timeout');
      }, STREAM_IDLE_TIMEOUT_MS);
    };
    const clearIdleTimer = () => {
      if (!idleTimer) return;
      clearTimeout(idleTimer);
      idleTimer = null;
    };

    const flushData = () => {
      if (dataLines.length === 0) return;
      const payload = dataLines.join('\n');
      dataLines = [];
      handlePayload(payload, sendDelta);
    };

    try {
      while (true) {
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
            flushData();
            continue;
          }
          if (line.startsWith(':')) continue;
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
            continue;
          }
          if (/^(event|id|retry):/.test(line)) continue;
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('{')) {
            flushData();
            handlePayload(trimmedLine, sendDelta);
          }
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        if (buffer.trim().startsWith('{')) {
          handlePayload(buffer, sendDelta);
        } else if (buffer.startsWith('data:')) {
          dataLines.push(buffer.slice(5).trimStart());
        }
      }
      flushData();
      sendDone();
    } finally {
      clearIdleTimer();
      // Release the connection early when the loop exits via timeout or abort.
      void reader.cancel().catch(() => {});
    }
  };

  try {
    let lastError: Error | null = null;
    let completed = false;

    for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt += 1) {
      if (controller.signal.aborted) break;
      if (sender.isDestroyed()) {
        return { ok: false, error: 'The window was closed.' };
      }
      try {
        await streamAttempt();
        completed = true;
        break;
      } catch (error) {
        if (controller.signal.aborted) break;
        if (finished) {
          // A [DONE] sentinel already completed the stream; ignore trailing noise.
          completed = true;
          break;
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        let retryable = false;
        let retryAfterMs: number | null = null;
        if (normalized instanceof ProviderHttpError) {
          retryable = RETRYABLE_HTTP_STATUSES.has(normalized.status);
          retryAfterMs = normalized.retryAfterMs;
        } else {
          retryable = isTransientNetworkError(normalized);
        }
        // Never retry after a payload reached the renderer: the restart would duplicate it.
        if (!retryable || emittedPayload || attempt >= MAX_CHAT_ATTEMPTS) {
          lastError = normalized;
          break;
        }
        if (sender.isDestroyed()) {
          return { ok: false, error: 'The window was closed.' };
        }
        // The retried attempt restarts the response, so drop partial usage state.
        usage = undefined;
        finishReason = null;
        await waitForRetry(retryDelayMs(attempt, retryAfterMs), controller.signal);
        if (controller.signal.aborted) break;
      }
    }

    if (completed || finished) return { ok: true };

    if (abortReason === 'user') {
      send({ type: 'error', message: 'Request aborted.', aborted: true });
      return { ok: false, error: 'aborted' };
    }
    if (abortReason === 'idle-timeout') {
      send({ type: 'error', message: IDLE_TIMEOUT_MESSAGE });
      return { ok: false, error: IDLE_TIMEOUT_MESSAGE };
    }
    if (abortReason === 'header-timeout') {
      send({ type: 'error', message: HEADER_TIMEOUT_MESSAGE });
      return { ok: false, error: HEADER_TIMEOUT_MESSAGE };
    }
    if (sender.isDestroyed()) {
      return { ok: false, error: 'The window was closed.' };
    }
    const message = lastError?.message || 'Unknown provider error';
    send({ type: 'error', message });
    return { ok: false, error: message };
  } catch (error) {
    // Unexpected failure outside the retry loop (e.g. sender/serialisation issues).
    if (abortReason === 'user') {
      send({ type: 'error', message: 'Request aborted.', aborted: true });
      return { ok: false, error: 'aborted' };
    }
    if (abortReason === 'idle-timeout') {
      send({ type: 'error', message: IDLE_TIMEOUT_MESSAGE });
      return { ok: false, error: IDLE_TIMEOUT_MESSAGE };
    }
    if (abortReason === 'header-timeout') {
      send({ type: 'error', message: HEADER_TIMEOUT_MESSAGE });
      return { ok: false, error: HEADER_TIMEOUT_MESSAGE };
    }
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown provider error';
    send({ type: 'error', message });
    return { ok: false, error: message };
  } finally {
    controller.signal.removeEventListener('abort', handleExternalAbort);
    controllers.delete(request.requestId);
  }
}

export function registerLlmIpc(): void {
  ipcMain.handle('llm:fetchModels', (_event, input: FetchModelsInput) => fetchModels(input));
  ipcMain.handle('llm:start', (event, request: LlmStartRequest) => runChat(event, request));
  ipcMain.handle('llm:abort', (_event, requestId: string) => {
    controllers.get(requestId)?.abort();
  });
}
