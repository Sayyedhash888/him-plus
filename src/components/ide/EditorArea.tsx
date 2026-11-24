import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { DiffEditor } from '@monaco-editor/react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderOpen,
  MessageSquare,
  PanelBottom,
  Play,
  Sparkles,
  SquareTerminal,
  X,
} from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useCoreStore } from '../../store/core';
import { useConfigStore } from '../../store/config';
import { useEditorStore, activeTabFrom } from '../../store/editor';
import { useSessionStore } from '../../store/sessions';
import { monaco } from '../../lib/monaco-setup';
import { registerActiveEditor } from '../../lib/editorBridge';
import {
  cn,
  languageForPath,
  relativeTo,
} from '../../lib/utils';
import { Button, Kbd, Modal, Spinner } from '../ui';
import { FileTypeIcon } from '../FileIcon';
import { BrandMark } from '../Brand';
import { InlineCtrlK, type InlineSession } from './InlineCtrlK';
import { ImageViewer } from './ImageViewer';
import { NotebookView } from '../notebook/NotebookView';
import { openWorkspace } from '../../lib/actions';
import { breakpointKey, useDebugStore } from '../../store/debug';
import { useAppTheme } from '../../lib/useTheme';
import { monacoThemeName } from '../../lib/themes';
import { useClickOutside } from '../../lib/hooks';
import { runCommandForTab } from '../../lib/runCommand';

function modelUri(path: string): string {
  return monaco.Uri.file(path).toString();
}

export function EditorArea({ active }: { active: boolean }) {
  const tabs = useEditorStore((state) => state.tabs);
  const activeTab = useEditorStore((state) => activeTabFrom(state));
  const reveal = useEditorStore((state) => state.reveal);
  const setActive = useEditorStore((state) => state.setActive);
  const closeTab = useEditorStore((state) => state.closeTab);
  const updateContent = useEditorStore((state) => state.updateContent);
  const setCursor = useEditorStore((state) => state.setCursor);
  const setMonacoProblems = useEditorStore((state) => state.setMonacoProblems);
  const save = useEditorStore((state) => state.save);
  const sidebarOpen = useEditorStore((state) => state.sidebarOpen);
  const aiPanelOpen = useEditorStore((state) => state.aiPanelOpen);
  const toggleAiPanel = useEditorStore((state) => state.toggleAiPanel);
  const bottomOpen = useEditorStore((state) => state.bottomOpen);
  const setBottomOpen = useEditorStore((state) => state.setBottomOpen);
  const setSidebarView = useEditorStore((state) => state.setSidebarView);
  const requestTerminalCommand = useEditorStore((state) => state.requestTerminalCommand);
  const workspace = useCoreStore((state) => state.workspace);
  const minimap = useConfigStore((state) => state.config?.prefs.minimap !== false);
  const appTheme = useAppTheme();
  const activeSession = useSessionStore((state) =>
    state.sessions.find((session) => session.id === state.activeId) || null,
  );
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const cursorDisposable = useRef<Monaco.IDisposable | null>(null);
  const [inlineSession, setInlineSession] = useState<InlineSession | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [savingClose, setSavingClose] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const openInlineRef = useRef<() => void>(() => {});
  const runMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(runMenuRef, () => setRunMenuOpen(false), runMenuOpen);

  const updateProblems = useCallback(() => {
    const pathByUri = new Map<string, string>();
    for (const tab of useEditorStore.getState().tabs) {
      pathByUri.set(modelUri(tab.path), tab.path);
    }
    const problems: ReturnType<typeof useEditorStore.getState>['problems'] = [];
    for (const model of monaco.editor.getModels()) {
      const path = pathByUri.get(model.uri.toString());
      if (!path) continue;
      for (const marker of monaco.editor.getModelMarkers({ resource: model.uri })) {
        problems.push({
          path,
          line: marker.startLineNumber,
          column: marker.startColumn,
          message: marker.message,
          severity: marker.severity === monaco.MarkerSeverity.Error ? 1 : marker.severity === monaco.MarkerSeverity.Warning ? 2 : 3,
          source: marker.source,
        });
      }
    }
    problems.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    setMonacoProblems(problems);
  }, [setMonacoProblems]);

  useEffect(() => {
    const disposable = monaco.editor.onDidChangeMarkers(() => updateProblems());
    updateProblems();
    return () => disposable.dispose();
  }, [updateProblems]);

  useEffect(() => {
    const timer = window.setTimeout(updateProblems, 350);
    return () => window.clearTimeout(timer);
  }, [activeTab?.path, tabs.length, updateProblems]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => editorRef.current?.layout(), 40);
    return () => window.clearTimeout(timer);
  }, [active, aiPanelOpen, sidebarOpen, bottomOpen]);

  useEffect(() => {
    setInlineSession(null);
    if (!activeTab) {
      editorRef.current = null;
      registerActiveEditor(null, null);
    } else if (
      activeTab.kind === 'image' ||
      activeTab.kind === 'notebook' ||
      activeTab.kind === 'diff'
    ) {
      editorRef.current = null;
      registerActiveEditor(null, null);
    } else {
      registerActiveEditor(editorRef.current, activeTab.path);
    }
    setCursor(1, 1);
  }, [activeTab?.path, setCursor]);

  useEffect(() => {
    if (!reveal || !editorRef.current || !activeTab) return;
    if (reveal.path.replaceAll('\\', '/').toLowerCase() !== activeTab.path.replaceAll('\\', '/').toLowerCase()) return;
    const editor = editorRef.current;
    const position = { lineNumber: reveal.line, column: reveal.column };
    editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
    editor.setPosition(position);
    editor.focus();
  }, [reveal, activeTab]);

  useEffect(() => {
    if (!activeTab) return;
    const element = tabBarRef.current?.querySelector('[data-active="true"]');
    element?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTab?.path]);

  useEffect(() => {
    return () => {
      cursorDisposable.current?.dispose();
      registerActiveEditor(null, null);
    };
  }, []);

  openInlineRef.current = () => {
    const editor = editorRef.current;
    const tab = activeTabFrom(useEditorStore.getState());
    if (!editor || !tab) return;
    const model = editor.getModel();
    if (!model) return;
    const selection = editor.getSelection();
    let original = '';
    let range: Monaco.Range;
    if (!selection || selection.isEmpty()) {
      const position = editor.getPosition() || { lineNumber: 1, column: 1 };
      const line = position.lineNumber;
      const maxColumn = model.getLineMaxColumn(line);
      range = new monaco.Range(line, 1, line, maxColumn);
      original = model.getLineContent(line);
    } else {
      original = model.getValueInRange(selection);
      range = new monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn,
      );
    }
    const beforeLines: string[] = [];
    for (let line = Math.max(1, range.startLineNumber - 14); line < range.startLineNumber; line += 1) {
      beforeLines.push(model.getLineContent(line));
    }
    const afterLines: string[] = [];
    for (
      let line = range.endLineNumber + 1;
      line <= Math.min(model.getLineCount(), range.endLineNumber + 14);
      line += 1
    ) {
      afterLines.push(model.getLineContent(line));
    }
    const visible = editor.getScrolledVisiblePosition({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    const layout = editor.getLayoutInfo();
    const anchor = visible
      ? { top: Math.max(8, visible.top), left: Math.max(8, visible.left), height: visible.height || 18 }
      : { top: 80, left: 80, height: 18 };
    setInlineSession({
      editor,
      range,
      original,
      language: tab.language,
      filePath: workspace ? relativeTo(workspace, tab.path) : tab.path,
      contextBefore: beforeLines.join('\n').slice(-3500),
      contextAfter: afterLines.join('\n').slice(0, 3500),
      anchor,
      containerWidth: layout.width,
      containerHeight: layout.height,
      lineCount: range.endLineNumber - range.startLineNumber + 1,
    });
  };

  const handleMount = (editor: Monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    cursorDisposable.current?.dispose();
    cursorDisposable.current = editor.onDidChangeCursorPosition((event) => {
      setCursor(event.position.lineNumber, event.position.column);
    });
    editor.addAction({
      id: 'him.inlineEdit',
      label: 'HIM: Inline edit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 0.1,
      run: () => openInlineRef.current(),
    });
    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = event.target.position?.lineNumber;
      const tab = activeTabFrom(useEditorStore.getState());
      if (!line || !tab || (tab.kind && tab.kind !== 'text')) return;
      useDebugStore.getState().toggleBreakpoint(tab.path, line);
    });
    registerActiveEditor(editor, activeTabFrom(useEditorStore.getState())?.path || null);
    window.setTimeout(updateProblems, 500);
  };

  const debugBreakpoints = useDebugStore((state) => state.breakpoints);
  const debugCurrentPath = useDebugStore((state) => state.currentPath);
  const debugCurrentLine = useDebugStore((state) => state.currentLine);
  const breakpointDecorations = useRef<string[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || (activeTab.kind && activeTab.kind !== 'text')) return;
    const key = breakpointKey(activeTab.path);
    const lines =
      debugBreakpoints[
        Object.keys(debugBreakpoints).find((entry) => breakpointKey(entry) === key) || ''
      ] || [];
    const decorations: Monaco.editor.IModelDeltaDecoration[] = lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        glyphMarginClassName: 'dap-breakpoint-glyph',
        glyphMarginHoverMessage: { value: `Breakpoint · line ${line}` },
      },
    }));
    if (debugCurrentPath && breakpointKey(debugCurrentPath) === key && debugCurrentLine) {
      decorations.push({
        range: new monaco.Range(debugCurrentLine, 1, debugCurrentLine, 1),
        options: { isWholeLine: true, className: 'dap-current-line' },
      });
    }
    breakpointDecorations.current = editor.deltaDecorations(
      breakpointDecorations.current,
      decorations,
    );
  }, [activeTab?.path, debugBreakpoints, debugCurrentPath, debugCurrentLine]);

  const requestClose = (path: string) => {
    const tab = useEditorStore.getState().tabs.find(
      (item) => item.path.replaceAll('\\', '/').toLowerCase() === path.replaceAll('\\', '/').toLowerCase(),
    );
    if (!tab) return;
    if (tab.dirty) setPendingClose(path);
    else closeTab(path);
  };

  const closeWithoutSaving = () => {
    if (pendingClose) closeTab(pendingClose);
    setPendingClose(null);
  };

  const saveAndClose = async () => {
    if (!pendingClose) return;
    setSavingClose(true);
    const ok = await save(pendingClose);
    setSavingClose(false);
    if (ok) {
      closeTab(pendingClose);
      setPendingClose(null);
    }
  };

  const relative = activeTab && workspace ? relativeTo(workspace, activeTab.path) : activeTab?.name || '';
  const segments = relative.split('/').filter(Boolean);
  const runCommand = activeTab ? runCommandForTab(activeTab) : null;

  const runActiveFile = async (newTerminal: boolean) => {
    const tab = activeTabFrom(useEditorStore.getState());
    if (!tab) return;
    const command = runCommandForTab(tab);
    if (!command) return;
    setRunMenuOpen(false);
    if (tab.dirty) {
      const saved = await useEditorStore.getState().save(tab.path);
      if (!saved) return;
    }
    requestTerminalCommand(command, { newTerminal });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ink-900">
      <div className="flex h-[34px] shrink-0 items-stretch border-b border-line bg-ink-950/50">
        <div
          ref={tabBarRef}
          className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto"
        >
          {tabs.length === 0 && (
            <div className="flex items-center gap-2 px-3 text-[9px] text-mist-ghost">
              <FileCode2 size={11} /> No file open
            </div>
          )}
          {tabs.map((tab) => {
            const isActive = tab.path === activeTab?.path;
            return (
              <div
                key={tab.path}
                data-active={isActive}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => setActive(tab.path)}
                onAuxClick={(event) => {
                  if (event.button === 1) requestClose(tab.path);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setActive(tab.path);
                }}
                title={workspace ? relativeTo(workspace, tab.path) : tab.path}
                className={cn(
                  'group relative flex h-full min-w-[120px] max-w-[210px] shrink-0 cursor-default items-center gap-1.5 border-r border-line/70 px-2.5 text-[10.5px] outline-none transition-colors',
                  isActive
                    ? 'bg-ink-900 text-mist-bright'
                    : 'bg-ink-950/30 text-mist-faint hover:bg-ink-850/70 hover:text-mist',
                )}
              >
                {isActive && <span className="absolute inset-x-0 top-0 h-[1px] bg-accent/70" />}
                <FileTypeIcon name={tab.name} size={12} />
                <span className="min-w-0 flex-1 truncate">{tab.name}</span>
                {tab.dirty && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sand group-hover:hidden" />
                )}
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    requestClose(tab.path);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-mist-ghost opacity-0 hover:bg-ink-750 hover:text-mist group-hover:opacity-100"
                  aria-label={`Close ${tab.name}`}
                >
                  <X size={9} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1">
          <button
            onClick={toggleAiPanel}
            className={cn(
              'flex h-7 items-center gap-1 rounded px-1.5 text-[9px] transition-colors',
              aiPanelOpen
                ? 'bg-accent/[0.07] text-accent-soft'
                : 'text-mist-faint hover:bg-ink-800 hover:text-mist',
            )}
            title="Toggle synced AI chat panel"
          >
            <MessageSquare size={11} />
            <span className="hidden lg:inline">Agent</span>
            {activeSession && (
              <span
                className={cn(
                  'h-1 w-1 rounded-full',
                  activeSession.status === 'running'
                    ? 'animate-pulse bg-accent'
                    : activeSession.status === 'waiting'
                      ? 'bg-sand'
                      : 'bg-mint',
                )}
              />
            )}
          </button>
          <button
            onClick={() => setBottomOpen(!bottomOpen)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors',
              bottomOpen
                ? 'bg-ink-800 text-mist'
                : 'text-mist-faint hover:bg-ink-800 hover:text-mist',
            )}
            title="Toggle terminal & problems (Ctrl+J)"
          >
            <PanelBottom size={12} />
          </button>
        </div>
      </div>

      {activeTab && (
        <div className="flex h-[23px] shrink-0 items-center gap-1 border-b border-line/60 bg-ink-900 px-3 text-[8.5px] text-mist-ghost">
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={8} className="shrink-0 text-mist-ghost" />}
              <span
                className={cn(
                  'truncate',
                  index === segments.length - 1 ? 'text-mist-dim' : 'text-mist-faint',
                )}
              >
                {segment}
              </span>
            </span>
          ))}
          <div className="flex-1" />
          {activeTab.dirty && <span className="text-sand/80">modified</span>}
          <span className="ml-2 font-mono uppercase tracking-[0.08em]">
            {activeTab.kind === 'image'
              ? 'image'
              : activeTab.kind === 'notebook'
                ? 'notebook'
                : activeTab.kind === 'diff'
                  ? 'diff'
                  : languageForPath(activeTab.path)}
          </span>
          {runCommand && (
            <div
              ref={runMenuRef}
              className="relative ml-2 flex h-5 items-stretch overflow-visible rounded border border-mint/25 bg-mint/[0.04]"
            >
              <button
                onClick={() => void runActiveFile(false)}
                className="flex items-center gap-1 rounded-l px-1.5 text-[8px] font-medium text-mint transition-colors hover:bg-mint/10"
                title="Run Python file"
                aria-label="Run Python file"
              >
                <Play size={8} fill="currentColor" />
                Run
              </button>
              <button
                onClick={() => setRunMenuOpen((open) => !open)}
                className="flex w-4 items-center justify-center border-l border-mint/20 text-mint/80 transition-colors hover:bg-mint/10 hover:text-mint"
                aria-label="Run options"
                aria-haspopup="menu"
                aria-expanded={runMenuOpen}
                title="Run options"
              >
                <ChevronDown size={8} />
              </button>
              {runMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-[80] mt-1 w-[222px] animate-slide-down overflow-hidden rounded-lg border border-line-strong bg-ink-800 p-1 shadow-panel"
                >
                  <button
                    role="menuitem"
                    onClick={() => void runActiveFile(false)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750"
                  >
                    <Play size={11} className="mt-0.5 shrink-0 text-mint" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-medium text-mist-bright">
                        Run Python file
                      </span>
                      <span className="mt-0.5 block text-[8.5px] text-mist-ghost">
                        Active terminal · saves first
                      </span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void runActiveFile(true)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink-750"
                  >
                    <SquareTerminal size={11} className="mt-0.5 shrink-0 text-mist-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-medium text-mist-bright">
                        Run in new terminal
                      </span>
                      <span className="mt-0.5 block text-[8.5px] text-mist-ghost">
                        Fresh shell in the workspace
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          {(activeTab.kind === undefined || activeTab.kind === 'text') && (
            <button
              onClick={() => openInlineRef.current()}
              className="ml-2 flex h-5 items-center gap-1 rounded border border-line px-1.5 text-[8px] text-mist-ghost transition-colors hover:border-accent/25 hover:text-accent-soft"
              title="Inline edit with HIM (Ctrl+K)"
            >
              <Sparkles size={8} /> Inline
              <Kbd>Ctrl K</Kbd>
            </button>
          )}
        </div>
      )}

      <div ref={containerRef} className="relative min-h-0 flex-1">
        {activeTab ? (
          activeTab.kind === 'image' ? (
            <ImageViewer
              dataUrl={activeTab.dataUrl}
              name={activeTab.name}
              path={activeTab.path}
            />
          ) : activeTab.kind === 'notebook' && activeTab.notebook ? (
            <NotebookView tab={activeTab} />
          ) : activeTab.kind === 'diff' ? (
            <DiffEditor
              height="100%"
              theme={monacoThemeName(appTheme)}
              original={activeTab.diffOriginal ?? ''}
              modified={activeTab.diffModified ?? ''}
              language={activeTab.language}
              originalModelPath={`inmemory://him/git/orig/${encodeURIComponent(activeTab.path)}`}
              modifiedModelPath={`inmemory://him/git/mod/${encodeURIComponent(activeTab.path)}`}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                fontFamily:
                  '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
                fontSize: 11.5,
                lineHeight: 19,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                renderOverviewRuler: false,
                overviewRulerBorder: false,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                padding: { top: 8, bottom: 12 },
                lineNumbersMinChars: 3,
                glyphMargin: false,
                diffWordWrap: 'on',
              }}
            />
          ) : (
          <Editor
            height="100%"
            path={modelUri(activeTab.path)}
            language={activeTab.language}
            value={activeTab.content}
            theme={monacoThemeName(appTheme)}
            onChange={(value) => {
              updateContent(activeTab.path, value ?? '');
            }}
            onMount={handleMount}
            loading={
              <div className="flex h-full items-center justify-center gap-2 bg-ink-900 text-[10px] text-mist-faint">
                <Spinner size={11} /> Loading editor
              </div>
            }
            options={{
              fontFamily:
                '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
              fontSize: 12.5,
              lineHeight: 21,
              fontLigatures: true,
              minimap: {
                enabled: minimap,
                scale: 1,
                renderCharacters: false,
                maxColumn: 84,
                showSlider: 'mouseover',
              },
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              cursorWidth: 2,
              smoothScrolling: true,
              padding: { top: 10, bottom: 28 },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderLineHighlight: 'all',
              renderWhitespace: 'selection',
              bracketPairColorization: {
                enabled: true,
                independentColorPoolPerBracketType: true,
              },
              guides: {
                indentation: true,
                bracketPairs: false,
                highlightActiveIndentation: true,
              },
              stickyScroll: { enabled: false },
              inlineSuggest: { enabled: true },
              wordWrap: 'off',
              tabSize: 2,
              lineNumbersMinChars: 3,
              glyphMargin: true,
              folding: true,
              contextmenu: true,
              fixedOverflowWidgets: true,
              scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
                useShadows: false,
              },
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              mouseWheelZoom: true,
              formatOnPaste: false,
              suggest: {
                showWords: true,
              },
            }}
          />
          )
        ) : (
          <Welcome active={active} />
        )}
        {inlineSession && (
          <InlineCtrlK
            session={inlineSession}
            onClose={() => {
              setInlineSession(null);
              window.setTimeout(() => editorRef.current?.focus(), 20);
            }}
          />
        )}
      </div>

      <Modal
        open={Boolean(pendingClose)}
        onClose={() => setPendingClose(null)}
        className="max-w-[440px]"
      >
        <div className="p-5">
          <h3 className="text-[13px] font-semibold text-mist-bright">Save changes?</h3>
          <p className="mt-2 text-[11px] leading-relaxed text-mist-dim">
            {pendingClose?.split(/[\\/]/).pop()} has unsaved changes. Save before closing this tab?
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPendingClose(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={closeWithoutSaving}>
              Don't save
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={savingClose}
              onClick={() => void saveAndClose()}
            >
              Save & close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Welcome({ active }: { active: boolean }) {
  const workspace = useCoreStore((state) => state.workspace);
  const git = useCoreStore((state) => state.git);
  const setSidebarView = useEditorStore((state) => state.setSidebarView);
  const setSidebarOpen = useEditorStore((state) => state.setSidebarOpen);
  const setBottomOpen = useEditorStore((state) => state.setBottomOpen);
  const setBottomTab = useEditorStore((state) => state.setBottomTab);

  const shortcuts = [
    ['Inline edit', 'Ctrl K'],
    ['Switch mode', 'Ctrl Shift M'],
    ['Terminal', 'Ctrl J'],
    ['Settings', 'Ctrl ,'],
  ];

  return (
    <div className="relative flex h-full overflow-y-auto">
      <div className="hairline-grid pointer-events-none absolute inset-0 opacity-35" />
      <div className="relative m-auto flex w-full max-w-[560px] flex-col items-center px-8 py-10 text-center">
        <BrandMark size={54} alt="HIM+" />
        <div className="mt-4 text-[8px] font-semibold uppercase tracking-[0.22em] text-mist-faint">
          Integrated development environment
        </div>
        <h1 className="mt-2 text-balance text-[24px] font-semibold leading-[1.15] tracking-[-0.035em] text-mist-bright">
          A precise surface for
          <br />
          <span className="text-mist-faint">AI-native edits.</span>
        </h1>
        <p className="mt-3 max-w-[390px] text-[10.5px] leading-relaxed text-mist-faint">
          Open a file, press Ctrl+K to edit with a fast model, and review every proposal as a real
          diff. Agent changes and approvals stay synced in the right panel.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {workspace ? (
            <Button
              size="sm"
              variant="accent"
              icon={<FolderOpen size={11} />}
              onClick={() => {
                setSidebarView('explorer');
                setSidebarOpen(true);
              }}
            >
              Browse files
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={<FolderOpen size={11} />}
              onClick={() => void openWorkspace()}
            >
              Open a folder
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBottomOpen(true);
              setBottomTab('terminal');
            }}
          >
            Open terminal
          </Button>
        </div>
        {workspace && (
          <div className="mt-4 flex max-w-full items-center gap-2 font-mono text-[8.5px] text-mist-ghost">
            <span className="max-w-[260px] truncate">{workspace}</span>
            {git?.branch && (
              <>
                <span>·</span>
                <span>{git.branch}</span>
              </>
            )}
          </div>
        )}
        <div className="mt-7 grid w-full max-w-[400px] grid-cols-2 gap-1.5">
          {shortcuts.map(([label, shortcut]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-md border border-line bg-ink-850/40 px-2.5 py-1.5 text-[9px] text-mist-faint"
            >
              <span>{label}</span>
              <Kbd>{shortcut}</Kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
