import { create } from 'zustand';
import type { Problem } from '../types';
import type { EditorTab } from '../types';
import type { NotebookData } from '@shared/types';
import { him, cleanErrorMessage } from '../lib/bridge';
import { basename, languageForPath, relativeTo } from '../lib/utils';
import { isImageFilePath } from '../lib/imagePath';
import { useCoreStore } from './core';
import { toast } from './toast';

export interface RevealRequest {
  path: string;
  line: number;
  column: number;
  nonce: number;
}

export interface TerminalCommandRequest {
  id: number;
  command: string;
  newTerminal: boolean;
}

interface EditorStore {
  tabs: EditorTab[];
  activePath: string | null;
  reveal: RevealRequest | null;
  problems: Problem[];
  monacoProblems: Problem[];
  lspDiagnostics: Record<string, Problem[]>;
  cursor: { line: number; column: number };
  sidebarView: 'explorer' | 'search' | 'git' | 'debug';
  sidebarOpen: boolean;
  aiPanelOpen: boolean;
  bottomOpen: boolean;
  bottomTab: 'terminal' | 'problems';
  bottomHeight: number;
  lastTerminal: { command: string; cwd: string; output: string; code: number | null } | null;
  terminalCommandRequest: TerminalCommandRequest | null;
  openFile(path: string, options?: { line?: number; column?: number }): Promise<boolean>;
  openDiff(path: string, original: string, modified: string): void;
  closeTab(path: string): void;
  closeTabsUnder(path: string): void;
  updatePath(oldPath: string, newPath: string): void;
  closeAll(): void;
  setActive(path: string): void;
  updateContent(path: string, content: string): void;
  updateNotebook(path: string, notebook: NotebookData): void;
  save(path?: string): Promise<boolean>;
  saveAll(): Promise<void>;
  reloadFromDisk(path: string, force?: boolean): Promise<void>;
  setReveal(path: string, line: number, column?: number): void;
  setMonacoProblems(problems: Problem[]): void;
  setLspDiagnostics(path: string, problems: Problem[]): void;
  setCursor(line: number, column: number): void;
  setSidebarView(view: 'explorer' | 'search' | 'git' | 'debug'): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  toggleAiPanel(): void;
  setAiPanelOpen(open: boolean): void;
  setBottomOpen(open: boolean): void;
  setBottomTab(tab: 'terminal' | 'problems'): void;
  setBottomHeight(height: number): void;
  setLastTerminal(value: { command: string; cwd: string; output: string; code: number | null } | null): void;
  requestTerminalCommand(command: string, options?: { newTerminal?: boolean }): void;
  clearTerminalCommand(id: number): void;
}

function samePath(a: string, b: string): boolean {
  return a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();
}

function problemPathKey(filePath: string): string {
  return filePath.replaceAll('\\', '/').toLowerCase();
}

function combineProblems(
  monacoProblems: Problem[],
  lspDiagnostics: Record<string, Problem[]>,
): Problem[] {
  const merged: Problem[] = [...monacoProblems];
  for (const list of Object.values(lspDiagnostics)) merged.push(...list);
  return merged.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
  );
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: [],
  activePath: null,
  reveal: null,
  problems: [],
  monacoProblems: [],
  lspDiagnostics: {},
  cursor: { line: 1, column: 1 },
  sidebarView: 'explorer',
  sidebarOpen: true,
  aiPanelOpen: true,
  bottomOpen: false,
  bottomTab: 'terminal',
  bottomHeight: 250,
  lastTerminal: null,
  terminalCommandRequest: null,
  openDiff: (filePath, original, modified) => {
    const diffPath = `${filePath}::diff`;
    const existing = get().tabs.find((tab) => samePath(tab.path, diffPath));
    const tab: EditorTab = {
      path: diffPath,
      name: `${basename(filePath)} (diff)`,
      language: languageForPath(filePath),
      content: '',
      savedContent: '',
      dirty: false,
      kind: 'diff',
      diffOriginal: original,
      diffModified: modified,
    };
    if (existing) {
      set((state) => ({
        tabs: state.tabs.map((item) => (samePath(item.path, diffPath) ? tab : item)),
        activePath: diffPath,
      }));
    } else {
      set((state) => ({ tabs: [...state.tabs, tab], activePath: diffPath }));
    }
  },
  openFile: async (path, options) => {
    const existing = get().tabs.find((tab) => samePath(tab.path, path));
    if (existing) {
      set({ activePath: existing.path });
      if (options?.line) get().setReveal(existing.path, options.line, options.column);
      return true;
    }
    try {
      if (isImageFilePath(path)) {
        const dataUrl = await him.fs.readImage(path);
        const tab: EditorTab = {
          path,
          name: basename(path),
          language: 'image',
          content: '',
          savedContent: '',
          dirty: false,
          kind: 'image',
          dataUrl,
        };
        set((state) => ({ tabs: [...state.tabs, tab], activePath: tab.path }));
        return true;
      }
      if (path.toLowerCase().endsWith('.ipynb')) {
        const notebook = await him.nb.open(path);
        if (notebook.warning) {
          toast('info', notebook.warning, 'Notebook');
        }
        const tab: EditorTab = {
          path,
          name: basename(path),
          language: 'json',
          content: '',
          savedContent: '',
          dirty: false,
          kind: 'notebook',
          notebook,
        };
        set((state) => ({ tabs: [...state.tabs, tab], activePath: tab.path }));
        return true;
      }
      const result = await him.fs.readFile(path);
      if (result.binary) {
        toast('error', `"${basename(path)}" looks like a binary file and cannot be opened.`, 'Cannot open file');
        return false;
      }
      const tab: EditorTab = {
        path: result.path,
        name: basename(result.path),
        language: languageForPath(result.path),
        content: result.content,
        savedContent: result.content,
        dirty: false,
      };
      set((state) => ({
        tabs: [...state.tabs, tab],
        activePath: tab.path,
        reveal: options?.line
          ? {
              path: tab.path,
              line: options.line,
              column: options.column || 1,
              nonce: Date.now(),
            }
          : state.reveal,
      }));
      return true;
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Could not open file');
      return false;
    }
  },
  closeTab: (path) => {
    const closing = get().tabs.find((tab) => samePath(tab.path, path));
    if (closing?.kind === 'notebook') void him.nb.dispose(closing.path).catch(() => undefined);
    set((state) => {
      const index = state.tabs.findIndex((tab) => samePath(tab.path, path));
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => !samePath(tab.path, path));
      let activePath = state.activePath;
      if (activePath && samePath(activePath, path)) {
        activePath = tabs[Math.min(index, tabs.length - 1)]?.path || null;
      }
      return {
        tabs,
        activePath,
        reveal: state.reveal && samePath(state.reveal.path, path) ? null : state.reveal,
      };
    });
  },
  closeAll: () => {
    for (const tab of get().tabs) {
      if (tab.kind === 'notebook') void him.nb.dispose(tab.path).catch(() => undefined);
    }
    set({ tabs: [], activePath: null, reveal: null });
  },
  closeTabsUnder: (path) => {
    set((state) => {
      const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
      const tabs = state.tabs.filter(
        (tab) =>
          !(
            tab.path.replaceAll('\\', '/').toLowerCase() === normalized ||
            tab.path
              .replaceAll('\\', '/')
              .toLowerCase()
              .startsWith(`${normalized}/`)
          ),
      );
      const activePath =
        state.activePath && tabs.some((tab) => samePath(tab.path, state.activePath!))
          ? state.activePath
          : tabs[tabs.length - 1]?.path || null;
      return { tabs, activePath };
    });
  },
  updatePath: (oldPath, newPath) => {
    set((state) => {
      let activePath = state.activePath;
      const tabs = state.tabs.map((tab) => {
        if (!samePath(tab.path, oldPath)) return tab;
        if (activePath && samePath(activePath, oldPath)) activePath = newPath;
        return {
          ...tab,
          path: newPath,
          name: basename(newPath),
          language: languageForPath(newPath),
        };
      });
      return { tabs, activePath };
    });
  },
  setActive: (path) => {
    const tab = get().tabs.find((item) => samePath(item.path, path));
    if (tab) set({ activePath: tab.path });
  },
  updateContent: (path, content) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        samePath(tab.path, path)
          ? { ...tab, content, dirty: content !== tab.savedContent }
          : tab,
      ),
    }));
  },
  updateNotebook: (path, notebook) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        samePath(tab.path, path) ? { ...tab, notebook, dirty: true } : tab,
      ),
    }));
  },
  save: async (path) => {
    const targetPath = path || get().activePath;
    if (!targetPath) return false;
    const tab = get().tabs.find((item) => samePath(item.path, targetPath));
    if (!tab) return false;
    if (tab.kind === 'image' || tab.kind === 'diff') return true;
    if (tab.kind === 'notebook') {
      if (!tab.notebook) return false;
      try {
        await him.nb.save(tab.notebook);
        set((state) => ({
          tabs: state.tabs.map((item) =>
            samePath(item.path, tab.path) ? { ...item, dirty: false } : item,
          ),
        }));
        useCoreStore.getState().bumpFs();
        void useCoreStore.getState().refreshGit();
        return true;
      } catch (error) {
        toast('error', cleanErrorMessage(error), 'Save failed');
        return false;
      }
    }
    const core = useCoreStore.getState();
    try {
      await him.fs.writeFile(tab.path, tab.content);
      set((state) => ({
        tabs: state.tabs.map((item) =>
          samePath(item.path, tab.path)
            ? { ...item, savedContent: item.content, dirty: false }
            : item,
        ),
      }));
      core.bumpFs();
      void core.refreshGit();
      return true;
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Save failed');
      return false;
    }
  },
  saveAll: async () => {
    const dirtyTabs = get().tabs.filter((tab) => tab.dirty);
    for (const tab of dirtyTabs) {
      await get().save(tab.path);
    }
  },
  reloadFromDisk: async (path, force = false) => {
    const tab = get().tabs.find((item) => samePath(item.path, path));
    if (!tab) return;
    if (tab.dirty && !force) return;
    if (tab.kind === 'notebook' || tab.kind === 'diff') return;
    if (tab.kind === 'image') {
      try {
        const dataUrl = await him.fs.readImage(tab.path);
        set((state) => ({
          tabs: state.tabs.map((item) =>
            samePath(item.path, tab.path) ? { ...item, dataUrl } : item,
          ),
        }));
      } catch {
        // Keep the last preview if the image became unreadable.
      }
      return;
    }
    try {
      const result = await him.fs.readFile(tab.path);
      if (result.binary) return;
      set((state) => ({
        tabs: state.tabs.map((item) =>
          samePath(item.path, tab.path)
            ? {
                ...item,
                content: result.content,
                savedContent: result.content,
                dirty: false,
              }
            : item,
        ),
      }));
    } catch {
      // The file may have been deleted or moved; leave the editor buffer untouched.
    }
  },
  setReveal: (path, line, column = 1) => {
    set({ reveal: { path, line, column, nonce: Date.now() + Math.random() } });
  },
  setMonacoProblems: (problems) =>
    set((state) => ({
      monacoProblems: problems,
      problems: combineProblems(problems, state.lspDiagnostics),
    })),
  setLspDiagnostics: (path, problems) =>
    set((state) => {
      const key = problemPathKey(path);
      const next = { ...state.lspDiagnostics };
      if (problems.length > 0) next[key] = problems;
      else delete next[key];
      return { lspDiagnostics: next, problems: combineProblems(state.monacoProblems, next) };
    }),
  setCursor: (line, column) => {
    const current = get().cursor;
    if (current.line !== line || current.column !== column) set({ cursor: { line, column } });
  },
  setSidebarView: (sidebarView) => set({ sidebarView, sidebarOpen: true }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  setBottomHeight: (bottomHeight) => set({ bottomHeight }),
  setLastTerminal: (lastTerminal) => set({ lastTerminal }),
  requestTerminalCommand: (command, options) => {
    set({
      terminalCommandRequest: {
        id: Date.now() + Math.random(),
        command,
        newTerminal: options?.newTerminal === true,
      },
    });
  },
  clearTerminalCommand: (id) => {
    set((state) =>
      state.terminalCommandRequest?.id === id ? { terminalCommandRequest: null } : state,
    );
  },
}));

export function activeTabFrom(state: { tabs: EditorTab[]; activePath: string | null }): EditorTab | null {
  if (!state.activePath) return null;
  return state.tabs.find((tab) => samePath(tab.path, state.activePath!)) || null;
}

export function relativeTabPath(root: string | null, path: string): string {
  return root ? relativeTo(root, path) : path;
}
