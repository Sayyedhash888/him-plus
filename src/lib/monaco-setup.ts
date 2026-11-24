import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { THEMES, monacoThemeName, type AppTheme } from './themes';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

function noHash(value: string): string {
  return value.replace('#', '');
}

function alpha(value: string, opacity: number): string {
  const hex = value.replace('#', '').slice(0, 6);
  const byte = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${hex}${byte}`;
}

function defineHimTheme(theme: AppTheme): void {
  const c = theme.colors;
  const e = theme.editor;
  const s = e.syntax;
  monaco.editor.defineTheme(monacoThemeName(theme), {
    base: theme.mode === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: noHash(e.foreground), background: noHash(e.background) },
      { token: 'comment', foreground: noHash(s.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: noHash(s.keyword) },
      { token: 'keyword.control', foreground: noHash(s.keyword) },
      { token: 'keyword.control.import', foreground: noHash(s.keyword) },
      { token: 'keyword.control.from', foreground: noHash(s.keyword) },
      { token: 'keyword.control.as', foreground: noHash(s.keyword) },
      { token: 'keyword.control.export', foreground: noHash(s.keyword) },
      { token: 'keyword.operator', foreground: noHash(s.operator) },
      { token: 'keyword.operator.new', foreground: noHash(s.keyword) },
      { token: 'storage', foreground: noHash(s.keyword) },
      { token: 'storage.type', foreground: noHash(s.keyword) },
      { token: 'string', foreground: noHash(s.string) },
      { token: 'string.escape', foreground: noHash(s.number) },
      { token: 'string.invalid', foreground: noHash(s.invalid) },
      { token: 'number', foreground: noHash(s.number) },
      { token: 'number.hex', foreground: noHash(s.number) },
      { token: 'regexp', foreground: noHash(s.string) },
      { token: 'type', foreground: noHash(s.type) },
      { token: 'type.identifier', foreground: noHash(s.type) },
      { token: 'typeParameter', foreground: noHash(s.type) },
      { token: 'class', foreground: noHash(s.type) },
      { token: 'interface', foreground: noHash(s.type) },
      { token: 'enum', foreground: noHash(s.type) },
      { token: 'namespace', foreground: noHash(s.type) },
      { token: 'identifier', foreground: noHash(s.variable) },
      { token: 'variable', foreground: noHash(s.variable) },
      { token: 'variable.predefined', foreground: noHash(c.mist) },
      { token: 'variable.parameter', foreground: noHash(s.variable) },
      { token: 'constant', foreground: noHash(s.number) },
      { token: 'function', foreground: noHash(s.functionName) },
      { token: 'function.identifier', foreground: noHash(s.functionName) },
      { token: 'member', foreground: noHash(s.variable) },
      { token: 'property', foreground: noHash(s.variable) },
      { token: 'delimiter', foreground: noHash(s.operator) },
      { token: 'operator', foreground: noHash(s.operator) },
      { token: 'tag', foreground: noHash(s.tag) },
      { token: 'tag.id', foreground: noHash(s.type) },
      { token: 'tag.class', foreground: noHash(s.type) },
      { token: 'attribute.name', foreground: noHash(s.attribute) },
      { token: 'attribute.value', foreground: noHash(s.string) },
      { token: 'metatag', foreground: noHash(s.keyword) },
      { token: 'annotation', foreground: noHash(s.type) },
      { token: 'invalid', foreground: noHash(s.invalid) },
      { token: 'markdown.header', foreground: noHash(s.type), fontStyle: 'bold' },
      { token: 'markdown.string', foreground: noHash(s.string) },
      { token: 'markdown.emphasis', foreground: noHash(s.variable), fontStyle: 'italic' },
      { token: 'markdown.bold', foreground: noHash(s.functionName), fontStyle: 'bold' },
      { token: 'markdown.link', foreground: noHash(s.type) },
      { token: 'markdown.code', foreground: noHash(s.string) },
      { token: 'markdown.quote', foreground: noHash(c.mistDim) },
      { token: 'json.key', foreground: noHash(s.keyword) },
      { token: 'string.key.json', foreground: noHash(s.keyword) },
      { token: 'string.value.json', foreground: noHash(s.string) },
      { token: 'keyword.json', foreground: noHash(s.number) },
      { token: 'number.json', foreground: noHash(s.number) },
    ],
    colors: {
      'editor.background': e.background,
      'editor.foreground': e.foreground,
      'editorLineNumber.foreground': e.lineNumber,
      'editorLineNumber.activeForeground': e.lineNumberActive,
      'editorCursor.foreground': e.cursor,
      'editor.selectionBackground': e.selection,
      'editor.inactiveSelectionBackground': e.inactiveSelection,
      'editor.selectionHighlightBackground': alpha(c.accent, 0.12),
      'editor.wordHighlightBackground': alpha(c.accent, 0.1),
      'editor.wordHighlightStrongBackground': alpha(c.accent, 0.16),
      'editor.lineHighlightBackground': e.lineHighlight,
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': c.lineFaint,
      'editorIndentGuide.activeBackground1': c.lineStrong,
      'editorBracketMatch.background': alpha(c.accent, 0.12),
      'editorBracketMatch.border': c.accentDim,
      'editorBracketHighlight.foreground1': c.accent,
      'editorBracketHighlight.foreground2': c.mint,
      'editorBracketHighlight.foreground3': c.azure,
      'editorBracketHighlight.foreground4': c.sand,
      'editorBracketHighlight.foreground5': c.mistDim,
      'editorBracketHighlight.foreground6': c.accentSoft,
      'editorWhitespace.foreground': c.line,
      'editorGutter.background': e.background,
      'editorGutter.modifiedBackground': c.accentDim,
      'editorGutter.addedBackground': c.mintDim,
      'editorGutter.deletedBackground': c.coralDim,
      'editorWidget.background': e.widgetBackground,
      'editorWidget.border': e.widgetBorder,
      'editorWidget.foreground': c.mist,
      'editorSuggestWidget.background': e.widgetBackground,
      'editorSuggestWidget.border': e.widgetBorder,
      'editorSuggestWidget.foreground': c.mist,
      'editorSuggestWidget.selectedBackground': c.ink750,
      'editorSuggestWidget.selectedForeground': c.mistBright,
      'editorSuggestWidget.highlightForeground': c.accent,
      'editorHoverWidget.background': e.widgetBackground,
      'editorHoverWidget.border': e.widgetBorder,
      'editorHoverWidget.foreground': c.mist,
      'editorGhostText.foreground': c.mistFaint,
      'editorGhostText.background': alpha(c.ink800, 0.72),
      'editorGhostText.border': c.line,
      'editorInfo.foreground': c.azure,
      'editorError.foreground': c.coral,
      'editorWarning.foreground': c.sand,
      'editorOverviewRuler.border': '#00000000',
      'editorOverviewRuler.addedForeground': c.mintDim,
      'editorOverviewRuler.deletedForeground': c.coralDim,
      'editorOverviewRuler.modifiedForeground': c.accentDim,
      'editorOverviewRuler.findMatchForeground': alpha(c.accent, 0.5),
      'editor.findMatchBackground': alpha(c.accent, 0.16),
      'editor.findMatchHighlightBackground': alpha(c.accent, 0.09),
      'editor.findMatchBorder': alpha(c.accent, 0.5),
      'editor.findWidget.background': e.widgetBackground,
      'editor.findWidget.border': e.widgetBorder,
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': alpha(c.mistGhost, 0.32),
      'scrollbarSlider.hoverBackground': alpha(c.mistGhost, 0.48),
      'scrollbarSlider.activeBackground': alpha(c.mistGhost, 0.62),
      'minimap.background': e.background,
      'minimapSlider.background': alpha(c.mistGhost, 0.18),
      'minimapSlider.hoverBackground': alpha(c.mistGhost, 0.3),
      'minimapSlider.activeBackground': alpha(c.mistGhost, 0.42),
      'editorCodeLens.foreground': c.mistFaint,
      'editorLightBulb.foreground': c.sand,
      'editorLightBulbAutoFix.foreground': c.accent,
      'editorLink.activeForeground': c.accent,
      'editorStickyScroll.background': c.ink850,
      'editorStickyScrollHover.background': c.ink750,
      'menu.background': e.widgetBackground,
      'menu.foreground': c.mistBright,
      'menu.selectionBackground': c.ink750,
      'menu.border': e.widgetBorder,
      'input.background': c.ink950,
      'input.border': c.line,
      'input.foreground': c.mistBright,
      'input.placeholderForeground': c.mistGhost,
      'dropdown.background': e.widgetBackground,
      'dropdown.border': e.widgetBorder,
      'quickInput.background': e.widgetBackground,
      'quickInput.foreground': c.mistBright,
      'focusBorder': c.accentDim,
      'list.activeSelectionBackground': c.ink750,
      'list.activeSelectionForeground': c.mistBright,
      'list.hoverBackground': c.ink750,
      'list.inactiveSelectionBackground': c.ink800,
      'diffEditor.insertedTextBackground': alpha(c.mint, 0.15),
      'diffEditor.removedTextBackground': alpha(c.coral, 0.15),
      'diffEditor.insertedLineBackground': alpha(c.mint, 0.08),
      'diffEditor.removedLineBackground': alpha(c.coral, 0.08),
      'diffEditor.diagonalFill': c.ink850,
      'diffEditor.border': c.line,
      'diffEditorOverview.insertedForeground': c.mintDim,
      'diffEditorOverview.removedForeground': c.coralDim,
      'editorError.background': alpha(c.coral, 0.08),
      'editorWarning.background': alpha(c.sand, 0.08),
      'problemsErrorIcon.foreground': c.coral,
      'problemsWarningIcon.foreground': c.sand,
      'problemsInfoIcon.foreground': c.azure,
      'sash.hoverBorder': c.accentDim,
    },
  });
}

for (const theme of THEMES) defineHimTheme(theme);

try {
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    resolveJsonModule: true,
  });
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
  });
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
} catch (error) {
  console.warn('[monaco] language service setup failed', error);
}

export { monaco };
