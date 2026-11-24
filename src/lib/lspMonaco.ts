import { monaco } from './monaco-setup';
import { him } from './bridge';

/**
 * Monaco's bundled workers already serve these languages; adding LSP providers
 * on top would duplicate every hover and definition result.
 */
const MONACO_BUILTIN = new Set([
  'json',
  'css',
  'scss',
  'less',
  'html',
  'handlebars',
  'razor',
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
]);

let registered = false;

/** Bridges Monaco hover/definition to the active language server. */
export function registerLspProviders(): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerHoverProvider({ pattern: '**' }, {
    async provideHover(model, position) {
      if (MONACO_BUILTIN.has(model.getLanguageId())) return null;
      const hover = await him.lsp.hover(
        model.uri.fsPath,
        position.lineNumber,
        position.column,
      );
      if (!hover) return null;
      return { contents: [{ value: hover.contents }] };
    },
  });

  monaco.languages.registerDefinitionProvider({ pattern: '**' }, {
    async provideDefinition(model, position) {
      if (MONACO_BUILTIN.has(model.getLanguageId())) return null;
      const locations = await him.lsp.definition(
        model.uri.fsPath,
        position.lineNumber,
        position.column,
      );
      return locations.map((location) => ({
        uri: monaco.Uri.file(location.path),
        range: new monaco.Range(
          location.range.start.line,
          location.range.start.character,
          location.range.end.line,
          location.range.end.character,
        ),
      }));
    },
  });
}
