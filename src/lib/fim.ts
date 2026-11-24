import { monaco } from './monaco-setup';
import { him } from './bridge';
import { findModelOption, resolveDefaultModel, useConfigStore } from '../store/config';

let registered = false;
let copilotCommandRegistered = false;
const cache = new Map<string, { at: number; text: string }>();

/**
 * Copilot needs a file-like document identity. Normal editor models are real
 * files; notebook cells use in-memory Monaco models, so derive a stable synthetic
 * python path from the notebook path + cell id.
 */
function copilotDocumentPath(model: { uri: { scheme: string; fsPath: string; path: string; toString(): string } }): string {
  if (model.uri.scheme === 'file') return model.uri.fsPath;
  const segments = model.uri.path.split('/').filter(Boolean);
  const encodedNotebook = segments[0] === 'him-notebook' ? segments[1] : '';
  const cellId = segments[segments.length - 1] || 'cell';
  let notebookPath = '';
  try {
    notebookPath = encodedNotebook ? decodeURIComponent(encodedNotebook) : '';
  } catch {
    notebookPath = encodedNotebook;
  }
  return notebookPath
    ? `${notebookPath}.${cellId}.py`
    : `${model.uri.toString().replace(/[^a-zA-Z0-9._-]+/g, '_')}.py`;
}

async function copilotCompletion(
  model: Parameters<typeof monaco.languages.registerInlineCompletionsProvider>[1] extends never
    ? never
    : import('monaco-editor').editor.ITextModel,
  position: import('monaco-editor').Position,
  token: import('monaco-editor').CancellationToken,
) {
  try {
    const result = await him.copilot.complete({
      path: copilotDocumentPath(model),
      text: model.getValue(),
      languageId: model.getLanguageId(),
      version: model.getVersionId(),
      line: position.lineNumber,
      character: position.column,
      triggerKind: 2,
    });
    if (token.isCancellationRequested || !result?.text) return null;
    return {
      insertText: result.text,
      range: result.range
        ? new monaco.Range(
            result.range.startLine,
            result.range.startColumn,
            result.range.endLine,
            result.range.endColumn,
          )
        : undefined,
      command: result.command
        ? {
            id: result.command.command,
            title: 'Copilot: accept completion',
            arguments: result.command.arguments,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

function fifoModel() {
  const config = useConfigStore.getState().config;
  if (!config || !config.fim.enabled) return null;
  const explicit = findModelOption(config, config.fim.model);
  if (explicit) return { option: explicit, mode: config.fim.mode };
  const fallback =
    resolveDefaultModel(config, 'fast') || resolveDefaultModel(config, 'primary');
  if (!fallback) return null;
  return { option: fallback, mode: config.fim.mode };
}

function cleanInsertion(text: string, suffix: string): string {
  let value = text.replace(/\r\n/g, '\n').replace(/<CURSOR>/g, '');
  value = value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  if (value.length > 1200) value = value.slice(0, 1200);
  if (!value.trim()) return '';

  const suffixStart = suffix.slice(0, 600);
  const maxOverlap = Math.min(value.length, suffixStart.length, 200);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (value.endsWith(suffixStart.slice(0, size))) {
      value = value.slice(0, value.length - size);
      break;
    }
  }
  return value;
}

export function registerFimProvider(): void {
  if (registered) return;
  registered = true;

  if (!copilotCommandRegistered) {
    copilotCommandRegistered = true;
    // Copilot asks clients to call this command after a completion is accepted.
    monaco.editor.registerCommand(
      'github.copilot.didAcceptCompletionItem',
      (_accessor, ...args: unknown[]) => {
        void him.copilot
          .accept({ command: 'github.copilot.didAcceptCompletionItem', arguments: args })
          .catch(() => undefined);
      },
    );
  }

  monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' },
    {
      async provideInlineCompletions(model, position, _context, token) {
        const config = useConfigStore.getState().config;
        if (config?.copilot?.enabled) {
          const copilotItem = await copilotCompletion(model, position, token);
          if (token.isCancellationRequested) return { items: [] };
          if (copilotItem) return { items: [copilotItem] };
          return { items: [] };
        }

        const selection = fifoModel();
        if (!selection) return { items: [] };
        if (!selection.option.provider.baseUrl.trim()) return { items: [] };

        const offset = model.getOffsetAt(position);
        const content = model.getValue();
        if (offset < 8) return { items: [] };
        const prefix = content.slice(Math.max(0, offset - 5000), offset);
        const suffix = content.slice(offset, Math.min(content.length, offset + 1800));
        if (!prefix.trimEnd() && !suffix.trim()) return { items: [] };

        const cacheKey = `${model.uri.toString()}:${offset}:${prefix.slice(-240)}:${suffix.slice(0, 160)}:${selection.mode}`;
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.at < 12_000) {
          return cached.text ? { items: [{ insertText: cached.text }] } : { items: [] };
        }

        await new Promise((resolve) => setTimeout(resolve, 180));
        if (token.isCancellationRequested) return { items: [] };

        try {
          const result = await him.fim.complete({
            baseUrl: selection.option.provider.baseUrl,
            apiKey: selection.option.provider.apiKey,
            headers: selection.option.provider.headers,
            model: selection.option.model.id,
            mode: selection.mode,
            prefix,
            suffix,
          });
          if (token.isCancellationRequested) return { items: [] };
          const insertion = cleanInsertion(result.text, suffix);
          cache.set(cacheKey, { at: Date.now(), text: insertion });
          if (cache.size > 80) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest) cache.delete(oldest[0]);
          }
          if (!insertion) return { items: [] };
          return {
            items: [
              {
                insertText: insertion,
              },
            ],
          };
        } catch (error) {
          console.warn('[fim] inline completion failed', error);
          return { items: [] };
        }
      },
      freeInlineCompletions() {
        // No per-request resources to release.
      },
    },
  );
}