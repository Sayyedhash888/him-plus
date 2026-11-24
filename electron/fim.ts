import { ipcMain } from 'electron';
import type { FimCompletionRequest, FimCompletionResult } from '../shared/types';

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

function completionsUrl(baseUrl: string): string {
  const base = trimBase(baseUrl);
  if (base.endsWith('/completions')) return base;
  if (base.endsWith('/chat/completions')) {
    return `${base.slice(0, -'/chat/completions'.length)}/completions`;
  }
  return `${base}/completions`;
}

function chatUrl(baseUrl: string): string {
  const base = trimBase(baseUrl);
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/completions')) {
    return `${base.slice(0, -'/completions'.length)}/chat/completions`;
  }
  return `${base}/chat/completions`;
}

function headersFor(
  apiKey: string,
  custom: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey && apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  for (const [key, value] of Object.entries(custom || {})) {
    if (!key.trim() || typeof value !== 'string') continue;
    if (key.toLowerCase() === 'authorization') delete headers.Authorization;
    headers[key] = value;
  }
  return headers;
}

function cleanCompletion(text: string): string {
  let value = text.replace(/\r\n/g, '\n');
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(value.trim());
  if (fence) value = fence[1];
  value = value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  if (value.length > 1200) value = value.slice(0, 1200);
  return value;
}

async function completeFim(input: FimCompletionRequest): Promise<FimCompletionResult> {
  if (!input || typeof input.prefix !== 'string') throw new Error('Invalid FIM request.');
  if (!input.model.trim()) throw new Error('No autocomplete model selected.');
  if (!input.prefix.trim() && !input.suffix.trim()) return { text: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    if (input.mode === 'fim') {
      const response = await fetch(completionsUrl(input.baseUrl), {
        method: 'POST',
        headers: headersFor(input.apiKey, input.headers),
        body: JSON.stringify({
          model: input.model,
          prompt: input.prefix,
          suffix: input.suffix,
          max_tokens: 160,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`FIM request failed (HTTP ${response.status}): ${text.trim().slice(0, 300)}`);
      }
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('FIM endpoint returned non-JSON output.');
      }
      if (json?.error) {
        throw new Error(json.error.message || json.error || 'FIM endpoint returned an error.');
      }
      const choice = json?.choices?.[0];
      const result = choice?.text ?? choice?.message?.content ?? '';
      return { text: cleanCompletion(String(result)) };
    }

    const response = await fetch(chatUrl(input.baseUrl), {
      method: 'POST',
      headers: headersFor(input.apiKey, input.headers),
      body: JSON.stringify({
        model: input.model,
        stream: false,
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              'You are an inline code completion engine. Continue the code at <CURSOR>. Return only the exact text to insert, with no Markdown fences, no comments about the task and no explanation. Preserve indentation and local style. Do not repeat code that already follows the cursor.',
          },
          {
            role: 'user',
            content: `Before the cursor:\n${input.prefix.slice(-3600)}\n<CURSOR>\nAfter the cursor:\n${input.suffix.slice(0, 1200)}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Completion request failed (HTTP ${response.status}): ${text.trim().slice(0, 300)}`);
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Completion endpoint returned non-JSON output.');
    }
    if (json?.error) {
      throw new Error(json.error.message || json.error || 'Completion endpoint returned an error.');
    }
    return { text: cleanCompletion(String(json?.choices?.[0]?.message?.content ?? '')) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Autocomplete request timed out.');
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function registerFimIpc(): void {
  ipcMain.handle('fim:complete', (_event, input: FimCompletionRequest) => completeFim(input));
}