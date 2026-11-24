import type { LlmMessage, LlmToolCall, LlmToolSchema, LlmUsage, LlmToolCallDelta } from '@shared/types';
import { him } from '../bridge';
import { uid } from '../utils';

export interface StreamChatOptions {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  temperature?: number;
  signal?: AbortSignal;
  onContentDelta?(text: string): void;
  onReasoningDelta?(text: string): void;
}

export interface StreamChatResult {
  content: string;
  reasoning: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage?: LlmUsage;
  finishReason?: string | null;
}

interface CallAccumulator {
  id?: string;
  name?: string;
  arguments: string;
}

function abortedError(): Error {
  const error = new Error('Request aborted.');
  error.name = 'AbortError';
  return error;
}

export function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  if (options.signal?.aborted) return Promise.reject(abortedError());
  const requestId = uid('llm');
  let content = '';
  let reasoning = '';
  let usage: LlmUsage | undefined;
  let finishReason: string | null = null;
  const callMap = new Map<number, CallAccumulator>();

  return new Promise<StreamChatResult>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      unsubscribe?.();
      unsubscribe = null;
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      const toolCalls = [...callMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
          id: call.id || uid('call'),
          name: call.name || '',
          arguments: call.arguments,
        }))
        .filter((call) => call.name);
      resolve({ content, reasoning, toolCalls, usage, finishReason });
    };

    const onAbort = () => {
      void him.llm.abort(requestId);
      finish(abortedError());
    };

    unsubscribe = him.llm.onEvent((event) => {
      if (event.requestId !== requestId) return;
      if (event.type === 'delta') {
        if (event.usage) usage = { ...usage, ...event.usage };
        if (event.finishReason !== undefined) finishReason = event.finishReason;
        if (event.content) {
          content += event.content;
          options.onContentDelta?.(event.content);
        }
        if (event.reasoning) {
          reasoning += event.reasoning;
          options.onReasoningDelta?.(event.reasoning);
        }
        if (event.toolCalls) {
          for (const delta of event.toolCalls) applyToolCallDelta(callMap, delta);
        }
        return;
      }
      if (event.type === 'done') {
        if (event.usage) usage = { ...usage, ...event.usage };
        if (event.finishReason !== undefined) finishReason = event.finishReason;
        finish();
        return;
      }
      if (event.type === 'error') {
        finish(
          event.aborted
            ? abortedError()
            : new Error(event.message || 'The provider stream failed.'),
        );
      }
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });

    const request = {
      requestId,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      headers: options.headers,
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
    };

    him.llm
      .start(request)
      .then((result) => {
        if (!result.ok && !settled) {
          finish(new Error(result.error || 'The provider request failed.'));
        }
      })
      .catch((error) => {
        if (!settled) finish(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function applyToolCallDelta(
  map: Map<number, CallAccumulator>,
  delta: LlmToolCallDelta,
): void {
  const index = typeof delta.index === 'number' ? delta.index : 0;
  const current = map.get(index) || { arguments: '' };
  if (delta.id) current.id = delta.id;
  if (delta.name) current.name = delta.name;
  if (delta.arguments) current.arguments += delta.arguments;
  map.set(index, current);
}

export function toolCallsToApi(toolCalls: { id: string; name: string; arguments: string }[]): LlmToolCall[] {
  return toolCalls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' },
  }));
}
