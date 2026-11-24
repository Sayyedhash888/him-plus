import type * as Monaco from 'monaco-editor';
import { monaco } from './monaco-setup';

let activeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
let activeEditorPath: string | null = null;

export function registerActiveEditor(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  path: string | null,
): void {
  activeEditor = editor;
  activeEditorPath = path;
}

export function getActiveEditor(): Monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor;
}

export function getActiveEditorPath(): string | null {
  return activeEditorPath;
}

export function applyCodeToEditor(code: string): boolean {
  if (!activeEditor) return false;
  const editor = activeEditor;
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!model || !selection) return false;

  editor.pushUndoStop();
  if (selection.isEmpty()) {
    const position = selection.getPosition();
    if (!position) return false;
    editor.executeEdits('him-apply', [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text: code,
        forceMoveMarkers: true,
      },
    ]);
  } else {
    editor.executeEdits('him-apply', [
      {
        range: selection,
        text: code,
        forceMoveMarkers: true,
      },
    ]);
  }
  editor.pushUndoStop();
  editor.focus();
  return true;
}
