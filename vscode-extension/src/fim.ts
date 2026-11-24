import * as vscode from 'vscode';
import {
  chatCompletionsUrl,
  cleanCompletion,
  completionsUrl,
  requestHeaders,
  resolveHimModel,
  resolveHimRuntime,
  trimSuffixOverlap,
  type ResolvedHimModel,
} from './himConfig';

interface CachedCompletion {
  at: number;
  text: string;
}

const cache = new Map<string, CachedCompletion>();
/** Last failure reason, reported once per change instead of on every keystroke. */
let lastReportedError = '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('him').get<boolean>('autocomplete.enabled', true);
}

function configPath(): string {
  return vscode.workspace.getConfiguration('him').get<string>('configPath', '');
}

function apiKeyOverride(): string {
  return vscode.workspace.getConfiguration('him').get<string>('apiKey', '');
}

/**
 * Picks the FIM model and reports why there is none. The HIM+ desktop app owns
 * `fim.enabled`, so a silent provider looks identical to a broken one; saying so
 * in the HIM+ output channel is the difference between "off" and "wrong".
 */
async function resolveFimModel(): Promise<
  { ok: true; model: ResolvedHimModel; mode: 'fim' | 'chat' } | { ok: false; reason: string }
> {
  const runtime = await resolveHimRuntime(configPath(), apiKeyOverride());
  if (!runtime) {
    return { ok: false, reason: 'HIM+ config.json was not found. Launch the HIM+ desktop app once.' };
  }
  if (runtime.keyError) return { ok: false, reason: runtime.keyError };

  const config = runtime.config;
  if (!config.fim?.enabled) {
    return {
      ok: false,
      reason:
        'FIM is disabled in the HIM+ desktop app. Open HIM+ → Autocomplete and enable it, or ' +
        '"Enable FIM" from the HIM+ chat panel header.',
    };
  }
  const mode: 'fim' | 'chat' = config.fim.mode === 'fim' ? 'fim' : 'chat';
  const explicit = resolveHimModel(config, config.fim.model, 'fast');
  const model = explicit || resolveHimModel(config, null, 'fast');
  if (!model) {
    return { ok: false, reason: 'No enabled HIM+ model is available for autocomplete.' };
  }
  if (!model.provider.baseUrl?.trim()) {
    return { ok: false, reason: `Provider "${model.provider.name}" has no base URL.` };
  }
  return { ok: true, model, mode };
}

function reportOnce(output: vscode.OutputChannel, reason: string): void {
  if (!reason || reason === lastReportedError) return;
  lastReportedError = reason;
  output.appendLine(`[fim] unavailable: ${reason}`);
}

async function requestCompletion(
  model: ResolvedHimModel,
  mode: 'fim' | 'chat',
  prefix: string,
  suffix: string,
  token: vscode.CancellationToken,
): Promise<string> {
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => controller.abort());
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const baseUrl = model.provider.baseUrl;
    const url = mode === 'fim' ? completionsUrl(baseUrl) : chatCompletionsUrl(baseUrl);
    const body =
      mode === 'fim'
        ? {
            model: model.model.id,
            prompt: prefix,
            suffix,
            max_tokens: 160,
            temperature: 0.2,
            stream: false,
          }
        : {
            model: model.model.id,
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
                content: `Before the cursor:\n${prefix.slice(-4000)}\n<CURSOR>\nAfter the cursor:\n${suffix.slice(0, 1400)}`,
              },
            ],
          };

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders(model.provider),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.trim().slice(0, 220)}`);
    }
    const json = JSON.parse(text) as {
      choices?: Array<{
        text?: string;
        message?: { content?: string };
      }>;
      error?: { message?: string } | string;
    };
    if (json.error) {
      const message =
        typeof json.error === 'string' ? json.error : json.error.message || 'Provider error';
      throw new Error(message);
    }
    const choice = json.choices?.[0];
    const raw = mode === 'fim' ? choice?.text : choice?.message?.content;
    return cleanCompletion(String(raw || ''));
  } finally {
    clearTimeout(timer);
    cancellation.dispose();
  }
}

export function registerHimFim(output: vscode.OutputChannel): vscode.Disposable {
  return vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    {
      async provideInlineCompletionItems(document, position, _context, token) {
        if (!isEnabled()) return new vscode.InlineCompletionList([]);
        if (document.uri.scheme !== 'file') return new vscode.InlineCompletionList([]);
        if (document.getText().length > 400_000) return new vscode.InlineCompletionList([]);

        const offset = document.offsetAt(position);
        if (offset < 8) return new vscode.InlineCompletionList([]);
        const content = document.getText();
        const prefix = content.slice(Math.max(0, offset - 4000), offset);
        const suffix = content.slice(offset, Math.min(content.length, offset + 1400));
        if (!prefix.trim() && !suffix.trim()) return new vscode.InlineCompletionList([]);

        const selection = await resolveFimModel();
        if (!selection.ok) {
          reportOnce(output, selection.reason);
          return new vscode.InlineCompletionList([]);
        }
        lastReportedError = '';

        const cacheKey = [
          document.uri.toString(),
          document.version,
          offset,
          selection.model.label,
          selection.mode,
          prefix.slice(-180),
          suffix.slice(0, 120),
        ].join('|');
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.at < 10_000) {
          return new vscode.InlineCompletionList(
            cached.text ? [new vscode.InlineCompletionItem(cached.text)] : [],
          );
        }

        await sleep(170);
        if (token.isCancellationRequested) return new vscode.InlineCompletionList([]);

        try {
          const text = await requestCompletion(
            selection.model,
            selection.mode,
            prefix,
            suffix,
            token,
          );
          const insertion = trimSuffixOverlap(text, suffix);
          cache.set(cacheKey, { at: Date.now(), text: insertion });
          if (cache.size > 80) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest) cache.delete(oldest[0]);
          }
          if (!insertion || token.isCancellationRequested) {
            return new vscode.InlineCompletionList([]);
          }
          return new vscode.InlineCompletionList([
            new vscode.InlineCompletionItem(insertion),
          ]);
        } catch (error) {
          if (!token.isCancellationRequested) {
            reportOnce(
              output,
              error instanceof Error ? error.message : String(error),
            );
          }
          return new vscode.InlineCompletionList([]);
        }
      },
    },
  );
}