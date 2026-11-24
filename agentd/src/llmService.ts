import {
  buildHeaders,
  chatEndpoint,
  normalizeUsage,
  streamChat,
  trimBase,
  type ChatStreamEvent,
  type LlmChatMessage,
} from './chatStream.ts';
import type { RpcServer } from './server.ts';

/** Model discovery, matching the `llm:fetchModels` behaviour the desktop uses. */
async function fetchModels(input: {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ models: string[] }> {
  // Derive the path with the URL API so a base carrying a query string keeps it.
  const url = new URL(trimBase(input.baseUrl));
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/chat/completions')) {
    url.pathname = `${path.slice(0, -'/chat/completions'.length)}/models`;
  } else if (path.endsWith('/completions')) {
    url.pathname = `${path.slice(0, -'/completions'.length)}/models`;
  } else {
    url.pathname = path.endsWith('/models') ? path : `${path}/models`;
  }
  const target = url.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await (input.fetchImpl ?? fetch)(target, {
      method: 'GET',
      headers: buildHeaders(input.apiKey, input.headers, 'application/json'),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Model discovery failed (HTTP ${response.status}): ${
          text.trim().slice(0, 300) || 'empty response'
        }`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Model discovery returned a non-JSON response.');
    }
    const record = json as { error?: unknown; data?: unknown; models?: unknown };
    if (record?.error) {
      const error = record.error;
      const message =
        typeof error === 'string'
          ? error
          : ((error as { message?: string })?.message ?? 'unknown error');
      throw new Error(`Provider returned an error: ${message}`);
    }
    const rawItems: unknown[] = Array.isArray(record?.data)
      ? (record.data as unknown[])
      : Array.isArray(record?.models)
        ? (record.models as unknown[])
        : Array.isArray(json)
          ? (json as unknown[])
          : [];
    const ids = rawItems
      .map((item) => {
        if (typeof item === 'string') return item;
        const entry = item as { id?: unknown; name?: unknown; model?: unknown; slug?: unknown };
        return entry?.id ?? entry?.name ?? entry?.model ?? entry?.slug ?? null;
      })
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
    return { models: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Model discovery timed out after 30 seconds.');
    const message = (error as Error)?.message || 'unknown error';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH/i.test(message)) {
      throw new Error(`Could not reach provider at ${target}. Check the base URL and network.`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

interface StartParams {
  requestId: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  messages: LlmChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Owns one `AbortController` per streamed request.
 *
 * The map is the reason N agents can stream at once: each request is independent,
 * so aborting one never touches another. Keys are client-supplied, so a duplicate
 * id is rejected rather than silently hijacking the first stream.
 */
class StreamRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(requestId: string): AbortController {
    if (this.controllers.has(requestId)) {
      throw new Error(`A request with id ${requestId} is already streaming.`);
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return controller;
  }

  abort(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  finish(requestId: string): void {
    this.controllers.delete(requestId);
  }

  get activeCount(): number {
    return this.controllers.size;
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.controllers.clear();
  }
}

export interface LlmServiceOptions {
  fetchImpl?: typeof fetch;
  /** Overrides the 120s/90s provider timers; tests use short values. */
  timeouts?: { headerMs?: number; idleMs?: number };
  onLog?: (message: string) => void;
}

/**
 * Registers the `llm.*` domain.
 *
 * `llm.stream` acknowledges at stream **start** and delivers content as
 * `stream.llm` notifications, ending with exactly one `done` or `error`. The
 * desktop's `llm:start` instead resolved only when the stream ended, which forced
 * every client to race a terminal event against the invoke response; a daemon
 * holding an agent loop cannot afford that ambiguity.
 */
export function registerLlmService(server: RpcServer, options: LlmServiceOptions = {}): {
  dispose(): void;
} {
  const registry = new StreamRegistry();

  server.register('llm.fetchModels', async (params) => {
    const input = params as {
      baseUrl: string;
      apiKey?: string;
      headers?: Record<string, string>;
    };
    if (!input || typeof input.baseUrl !== 'string') {
      throw new Error('llm.fetchModels requires a baseUrl.');
    }
    return fetchModels({ ...input, fetchImpl: options.fetchImpl });
  });

  server.register('llm.stream', async (params, context) => {
    const input = params as StartParams;
    if (!input || typeof input.requestId !== 'string' || !input.requestId) {
      throw new Error('llm.stream requires a requestId.');
    }
    const { requestId } = input;
    const controller = registry.start(requestId);

    // Bridge the client's abort signal onto this stream only.
    const onClientAbort = () => controller.abort();
    if (context.signal.aborted) onClientAbort();
    else context.signal.addEventListener('abort', onClientAbort, { once: true });

    const emit = (event: ChatStreamEvent): void => {
      context.stream('stream.llm', { requestId, ...event });
    };

    // Run the stream detached from the response so the client is acknowledged
    // immediately; the stream's own terminal notification is the completion signal.
    void streamChat(
      {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        headers: input.headers,
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      },
      {
        signal: controller.signal,
        onEvent: emit,
        fetchImpl: options.fetchImpl,
        timeouts: options.timeouts,
      },
    )
      .catch((error: unknown) => {
        options.onLog?.(`stream ${requestId} threw: ${(error as Error)?.message}`);
        emit({ type: 'error', message: (error as Error)?.message || 'Stream failed.' });
      })
      .finally(() => {
        options.onLog?.(`stream ${requestId} finished`);
        registry.finish(requestId);
        context.signal.removeEventListener('abort', onClientAbort);
      });

    return { accepted: true, requestId };
  });

  server.register('llm.abort', (params) => {
    const input = params as { requestId?: string };
    if (!input || typeof input.requestId !== 'string') {
      throw new Error('llm.abort requires a requestId.');
    }
    return { aborted: registry.abort(input.requestId) };
  });

  server.register('llm.status', () => ({
    active: registry.activeCount,
    pending: server.pendingCount,
  }));

  return {
    dispose: () => registry.abortAll(),
  };
}

export { fetchModels };
