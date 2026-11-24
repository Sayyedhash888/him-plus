import { create } from 'zustand';
import { cleanErrorMessage, him } from '../lib/bridge';
import type { DebugBreakpoint } from '@shared/types';
import { useCoreStore } from './core';
import { useEditorStore } from './editor';
import { toast } from './toast';

export interface DebugFrame {
  id: number;
  name: string;
  path?: string;
  line: number;
  column: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  children?: DebugVariable[];
}

export interface DebugScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
  variables?: DebugVariable[];
}

type DebugStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export function breakpointKey(filePath: string): string {
  return filePath.replaceAll('\\', '/').toLowerCase();
}

interface DebugStore {
  status: DebugStatus;
  error?: string;
  threadId: number | null;
  breakpoints: Record<string, number[]>;
  frames: DebugFrame[];
  selectedFrameId: number | null;
  scopes: DebugScope[];
  currentPath: string | null;
  currentLine: number | null;
  consoleLines: string[];
  toggleBreakpoint(path: string, line: number): void;
  removeBreakpoint(path: string, line: number): void;
  clearBreakpoints(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  step(command: 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause'): Promise<void>;
  selectFrame(frameId: number): Promise<void>;
  loadScope(scope: DebugScope): Promise<void>;
  loadVariable(variable: DebugVariable): Promise<void>;
  handleEvent(event: string, body: unknown): void;
  initListeners(): void;
}

let listenersInitialized = false;

function editorDebugTarget(): { file: string; workspace: string } | null {
  const editor = useEditorStore.getState();
  const tab = editor.tabs.find((item) => item.path === editor.activePath);
  const workspace = useCoreStore.getState().workspace;
  if (!tab || !workspace) return null;
  if (tab.kind && tab.kind !== 'text') return null;
  return { file: tab.path, workspace };
}

function revealLocation(filePath: string, line: number, column = 1): void {
  const editor = useEditorStore.getState();
  void editor.openFile(filePath).then(() => {
    useEditorStore.getState().setReveal(filePath, line, column);
  });
}

export const useDebugStore = create<DebugStore>()((set, get) => ({
  status: 'idle',
  threadId: null,
  breakpoints: {},
  frames: [],
  selectedFrameId: null,
  scopes: [],
  currentPath: null,
  currentLine: null,
  consoleLines: [],

  toggleBreakpoint: (filePath, line) => {
    const existingKey = Object.keys(get().breakpoints).find(
      (key) => breakpointKey(key) === breakpointKey(filePath),
    );
    const key = existingKey || filePath;
    const existing = get().breakpoints[key] || [];
    const lines = existing.includes(line)
      ? existing.filter((value) => value !== line)
      : [...existing, line].sort((a, b) => a - b);
    set((state) => {
      const breakpoints = { ...state.breakpoints };
      if (lines.length > 0) breakpoints[key] = lines;
      else delete breakpoints[key];
      return { breakpoints };
    });
    if (get().status === 'running' || get().status === 'stopped') {
      void him.debug
        .request({
          command: 'setBreakpoints',
          args: {
            source: { path: key },
            breakpoints: lines.map((value) => ({ line: value })),
            lines,
          },
        })
        .catch(() => undefined);
    }
  },

  removeBreakpoint: (filePath, line) => {
    const key = Object.keys(get().breakpoints).find(
      (entry) => breakpointKey(entry) === breakpointKey(filePath),
    );
    if (!key) return;
    const lines = (get().breakpoints[key] || []).filter((value) => value !== line);
    set((state) => {
      const breakpoints = { ...state.breakpoints };
      if (lines.length > 0) breakpoints[key] = lines;
      else delete breakpoints[key];
      return { breakpoints };
    });
    if (get().status === 'running' || get().status === 'stopped') {
      void him.debug
        .request({
          command: 'setBreakpoints',
          args: {
            source: { path: key },
            breakpoints: lines.map((value) => ({ line: value })),
            lines,
          },
        })
        .catch(() => undefined);
    }
  },

  clearBreakpoints: () => {
    set({ breakpoints: {} });
    for (const path of Object.keys(get().breakpoints)) {
      void him.debug
        .request({
          command: 'setBreakpoints',
          args: { source: { path }, breakpoints: [], lines: [] },
        })
        .catch(() => undefined);
    }
  },

  start: async () => {
    const target = editorDebugTarget();
    if (!target) {
      toast('info', 'Open a Python file before starting the debugger.', 'Debug');
      return;
    }
    if (!/\.py$/i.test(target.file)) {
      toast('info', 'The built-in debugger supports Python files (debugpy).', 'Debug');
      return;
    }
    set({ status: 'starting', error: undefined, consoleLines: [] });
    try {
      const breakpoints: DebugBreakpoint[] = Object.entries(get().breakpoints).map(
        ([path, lines]) => ({ path, lines }),
      );
      const result = await him.debug.start({
        workspace: target.workspace,
        file: target.file,
        breakpoints,
        justMyCode: true,
      });
      if (!result.ok) {
        set({ status: 'error', error: result.error });
        toast('error', result.error || 'Could not start the debugger.', 'Debug failed');
        return;
      }
      set({ status: 'running' });
      toast('success', 'Debug session started. Use F10 to step once it stops.', 'Debug');
    } catch (error) {
      const message = cleanErrorMessage(error);
      set({ status: 'error', error: message });
      toast('error', message, 'Debug failed');
    }
  },

  stop: async () => {
    try {
      await him.debug.stop();
    } catch {
      // ignore
    }
    set({
      status: 'idle',
      threadId: null,
      frames: [],
      scopes: [],
      currentPath: null,
      currentLine: null,
      selectedFrameId: null,
    });
  },

  step: async (command) => {
    if (get().status === 'idle' || get().status === 'error') {
      await get().start();
      return;
    }
    const threadId = get().threadId ?? 1;
    try {
      await him.debug.request({ command, args: { threadId } });
      if (command === 'pause') set({ status: 'running' });
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Debug');
    }
  },

  selectFrame: async (frameId) => {
    const frame = get().frames.find((item) => item.id === frameId);
    if (!frame) return;
    set({ selectedFrameId: frameId, scopes: [] });
    if (frame.path) {
      set({ currentPath: frame.path, currentLine: frame.line });
      revealLocation(frame.path, frame.line, frame.column);
    }
    try {
      const result = (await him.debug.request({
        command: 'scopes',
        args: { frameId },
      })) as { scopes?: Array<{ name: string; variablesReference: number; expensive?: boolean }> };
      const scopes = (result.scopes || []).map((scope) => ({
        name: scope.name,
        variablesReference: scope.variablesReference,
        expensive: scope.expensive,
        variables: undefined,
      }));
      set({ scopes });
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Debug');
    }
  },

  loadScope: async (scope) => {
    try {
      const result = (await him.debug.request({
        command: 'variables',
        args: { variablesReference: scope.variablesReference },
      })) as {
        variables?: Array<{ name: string; value: string; type?: string; variablesReference: number }>;
      };
      const variables = (result.variables || []).map((variable) => ({ ...variable }));
      set((state) => ({
        scopes: state.scopes.map((item) =>
          item.variablesReference === scope.variablesReference ? { ...item, variables } : item,
        ),
      }));
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Debug');
    }
  },

  loadVariable: async (variable) => {
    try {
      const result = (await him.debug.request({
        command: 'variables',
        args: { variablesReference: variable.variablesReference },
      })) as {
        variables?: Array<{ name: string; value: string; type?: string; variablesReference: number }>;
      };
      const children = (result.variables || []).map((item) => ({ ...item }));
      set((state) => ({
        scopes: state.scopes.map((scope) => ({
          ...scope,
          variables: scope.variables?.map((item) =>
            item === variable || item.name === variable.name
              ? { ...item, children }
              : item,
          ),
        })),
      }));
    } catch (error) {
      toast('error', cleanErrorMessage(error), 'Debug');
    }
  },

  handleEvent: (event, body) => {
    const payload = (body || {}) as Record<string, unknown>;
    if (event === 'stopped') {
      const threadId = typeof payload.threadId === 'number' ? payload.threadId : 1;
      set({ status: 'stopped', threadId });
      void (async () => {
        try {
          const result = (await him.debug.request({
            command: 'stackTrace',
            args: { threadId, startFrame: 0, levels: 30 },
          })) as {
            stackFrames?: Array<{
              id: number;
              name: string;
              line: number;
              column: number;
              source?: { path?: string };
            }>;
          };
          const frames: DebugFrame[] = (result.stackFrames || []).map((frame) => ({
            id: frame.id,
            name: frame.name,
            path: frame.source?.path,
            line: frame.line,
            column: frame.column,
          }));
          set({ frames });
          const top = frames[0];
          if (top) {
            set({ selectedFrameId: top.id });
            if (top.path) {
              set({ currentPath: top.path, currentLine: top.line });
              revealLocation(top.path, top.line, top.column);
            }
            await get().selectFrame(top.id);
          }
        } catch (error) {
          toast('error', cleanErrorMessage(error), 'Debug');
        }
      })();
      return;
    }
    if (event === 'continued') {
      set({ status: 'running', frames: [], scopes: [], currentPath: null, currentLine: null });
      return;
    }
    if (event === 'output') {
      const text = typeof payload.output === 'string' ? payload.output : '';
      if (text) {
        set((state) => ({
          consoleLines: [...state.consoleLines, text].slice(-600),
        }));
      }
      return;
    }
    if (event === 'terminated' || event === 'exited') {
      set({ status: 'stopped' });
      return;
    }
  },

  initListeners: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;
    him.debug.onEvent(({ event, body }) => get().handleEvent(event, body));
    him.debug.onLog((line) => {
      set((state) => ({ consoleLines: [...state.consoleLines, `${line}\n`].slice(-600) }));
    });
  },
}));
