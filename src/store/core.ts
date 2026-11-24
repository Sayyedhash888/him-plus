import { create } from 'zustand';
import type { GitStatus, Mode } from '@shared/types';
import { him, cleanErrorMessage } from '../lib/bridge';
import { basename } from '../lib/utils';
import { useConfigStore } from './config';
import { toast } from './toast';

function workspaceLabel(path: string | null): string {
  if (!path) return 'No workspace';
  return basename(path) || path;
}

interface CoreStore {
  booted: boolean;
  bootError?: string;
  mode: Mode;
  workspace: string | null;
  git: GitStatus | null;
  workspaceFiles: string[];
  fsRevision: number;
  settingsOpen: boolean;
  quickOpen: boolean;
  setBooted(booted: boolean, error?: string): void;
  setMode(mode: Mode): void;
  setWorkspace(path: string | null): void;
  setGit(git: GitStatus | null): void;
  setWorkspaceFiles(files: string[]): void;
  bumpFs(): void;
  setSettingsOpen(open: boolean): void;
  setQuickOpen(open: boolean): void;
  refreshGit(): Promise<void>;
  refreshWorkspaceFiles(): Promise<void>;
}

export const useCoreStore = create<CoreStore>()((set, get) => ({
  booted: false,
  bootError: undefined,
  mode: 'agent',
  workspace: null,
  git: null,
  workspaceFiles: [],
  fsRevision: 0,
  settingsOpen: false,
  quickOpen: false,
  setBooted: (booted, error) => set({ booted, bootError: error }),
  setMode: (mode) => {
    set({ mode });
    useConfigStore.getState().setPrefs({ mode });
  },
  setWorkspace: (path) => set({ workspace: path, git: null, workspaceFiles: [] }),
  setGit: (git) => set({ git }),
  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  bumpFs: () => set((state) => ({ fsRevision: state.fsRevision + 1 })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setQuickOpen: (open) => set({ quickOpen: open }),
  refreshGit: async () => {
    const workspace = get().workspace;
    if (!workspace) {
      set({ git: null });
      return;
    }
    try {
      const git = await him.git.status(workspace);
      set({ git });
    } catch (error) {
      set({ git: null });
      toast('error', cleanErrorMessage(error), 'Git status failed');
    }
  },
  refreshWorkspaceFiles: async () => {
    const workspace = get().workspace;
    if (!workspace) {
      set({ workspaceFiles: [] });
      return;
    }
    try {
      const files = await him.fs.listFiles(workspace, 5000);
      set({ workspaceFiles: files });
    } catch {
      set({ workspaceFiles: [] });
    }
  },
}));

export function useWorkspaceName(): string {
  return useCoreStore((state) => workspaceLabel(state.workspace));
}

export function useWorkspacePath(): string | null {
  return useCoreStore((state) => state.workspace);
}
