import type { LspDiagnostic } from '@shared/types';
import { him } from './bridge';
import { useCoreStore } from '../store/core';
import { useEditorStore } from '../store/editor';

const SYNC_DEBOUNCE_MS = 220;
/** Monaco already ships language services for these; LSP duplicates would double up. */
const MONACO_BUILTIN_LANGUAGES = new Set([
  'json',
  'css',
  'scss',
  'less',
  'html',
  'handlebars',
  'razor',
]);

let started = false;
let appliedRoot = '';
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const knownText = new Map<string, string>();
const versions = new Map<string, number>();

function diagnosticsToProblems(path: string, diagnostics: LspDiagnostic[]) {
  return diagnostics.map((diagnostic) => ({
    path,
    line: diagnostic.line,
    column: diagnostic.column,
    message: diagnostic.source
      ? `${diagnostic.message} (${diagnostic.source})`
      : diagnostic.message,
    severity: diagnostic.severity === 4 ? 3 : diagnostic.severity,
    source: diagnostic.source || 'lsp',
  }));
}

function syncDocuments(forceOpen = false): void {
  const state = useEditorStore.getState();
  const seen = new Set<string>();
  for (const tab of state.tabs) {
    if (tab.kind === 'image') continue;
    if (!tab.language || tab.language === 'plaintext') continue;
    seen.add(tab.path);
    const known = knownText.get(tab.path);
    const isBuiltin = MONACO_BUILTIN_LANGUAGES.has(tab.language);
    if (isBuiltin) continue;
    if (known === undefined || forceOpen) {
      knownText.set(tab.path, tab.content);
      versions.set(tab.path, 1);
      void him.lsp.openDocument({
        path: tab.path,
        languageId: tab.language,
        text: tab.content,
        version: 1,
      });
    } else if (known !== tab.content) {
      const version = (versions.get(tab.path) || 1) + 1;
      knownText.set(tab.path, tab.content);
      versions.set(tab.path, version);
      void him.lsp.changeDocument({
        path: tab.path,
        languageId: tab.language,
        text: tab.content,
        version,
      });
    }
  }
  for (const path of [...knownText.keys()]) {
    if (seen.has(path)) continue;
    knownText.delete(path);
    versions.delete(path);
    void him.lsp.closeDocument(path);
  }
}

function scheduleSync(): void {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncDocuments(false);
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Keeps the main-process language servers in sync with editor tabs and folds
 * their published diagnostics into the Problems pane alongside Monaco's own.
 */
export function startLspBridge(): void {
  if (started) return;
  started = true;

  him.lsp.onDiagnostics((event) => {
    if (event.root && appliedRoot && event.root !== appliedRoot) return;
    useEditorStore
      .getState()
      .setLspDiagnostics(event.path, diagnosticsToProblems(event.path, event.diagnostics));
  });

  const applyRoot = (root: string | null) => {
    const next = root || '';
    if (next === appliedRoot) return;
    appliedRoot = next;
    knownText.clear();
    versions.clear();
    void him.lsp.setRoot(next).catch(() => undefined);
    scheduleSync();
  };

  applyRoot(useCoreStore.getState().workspace);
  useCoreStore.subscribe((state) => {
    applyRoot(state.workspace);
  });
  useEditorStore.subscribe((state, previous) => {
    if (state.tabs === previous.tabs) return;
    scheduleSync();
  });
  syncDocuments(true);
}
