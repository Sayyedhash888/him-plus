import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { monaco } from '../../lib/monaco-setup';
import { useAppTheme } from '../../lib/useTheme';
import { monacoThemeName } from '../../lib/themes';
import { useConfigStore } from '../../store/config';
import { useJupyterStore } from '../../store/jupyter';

const FONT_FAMILY =
  '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace';

/**
 * Monaco-backed notebook code cell.
 *
 * Using Monaco here is what makes inline FIM work inside notebooks: HIM+'s
 * inline completions provider is registered for every Monaco model, so the
 * configured autocomplete model now produces ghost text in notebook cells just
 * like it does in the normal editor and like JupyterLab + Copilot.
 */
export function CellCodeEditor({
  cellId,
  notebookPath,
  language,
  value,
  onChange,
  onRun,
  onRunAndInsertBelow,
}: {
  cellId: string;
  notebookPath: string;
  language: string;
  value: string;
  onChange(value: string): void;
  onRun(): void;
  onRunAndInsertBelow(): void;
}) {
  const appTheme = useAppTheme();
  const config = useConfigStore((state) => state.config);
  const jupyter = useJupyterStore((state) => state.config);
  const behavior =
    jupyter?.detected && config?.prefs.matchJupyterNotebook !== false ? jupyter : null;
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelUri = `inmemory://him-notebook/${encodeURIComponent(notebookPath)}/${cellId}`;
  const lineCount = Math.max(1, value.split('\n').length);
  const lineHeight = 18;
  const height = Math.min(420, Math.max(56, lineCount * lineHeight + 18));

  useEffect(() => {
    return () => {
      const model = monaco.editor.getModel(monaco.Uri.parse(modelUri));
      model?.dispose();
    };
  }, [modelUri]);

  const handleMount = (editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => onRun());
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.Enter,
      () => onRunAndInsertBelow(),
    );
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRun(),
    );
    editor.addAction({
      id: 'him.notebook.triggerInlineSuggestion',
      label: 'HIM: Trigger inline suggestion',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Backslash],
      run: () => {
        void editor.trigger('keyboard', 'editor.action.inlineSuggest.trigger', {});
      },
    });
    editor.focus();
  };

  return (
    <div
      className="overflow-hidden rounded border border-line/70 bg-ink-950 transition-colors focus-within:border-accent/45"
      style={{ height }}
    >
      <Editor
        height="100%"
        path={modelUri}
        language={language}
        value={value}
        theme={monacoThemeName(appTheme)}
        onChange={(next) => onChange(next ?? '')}
        onMount={handleMount}
        loading={<div className="px-3 py-2 font-mono text-[10px] text-mist-ghost">LoadingÃ¢â‚¬Â¦</div>}
        options={{
          fontFamily: FONT_FAMILY,
          fontSize: 11.5,
          lineHeight,
          lineNumbers: behavior?.lineNumbers ? 'on' : 'off',
          glyphMargin: false,
          folding: false,
          minimap: { enabled: false },
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'auto',
            horizontalScrollbarSize: 7,
            useShadows: false,
          },
          automaticLayout: true,
          wordWrap: behavior ? (behavior.lineWrap ? 'on' : 'off') : 'on',
          autoClosingBrackets: behavior
            ? behavior.autoClosingBrackets
              ? 'always'
              : 'never'
            : 'languageDefined',
          padding: { top: 8, bottom: 8 },
          contextmenu: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          inlineSuggest: { enabled: true },
          tabSize: 4,
          insertSpaces: true,
          mouseWheelZoom: false,
          scrollBeyondLastColumn: 5,
        }}
      />
    </div>
  );
}



