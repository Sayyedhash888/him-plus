import { create } from 'zustand';
import type { AgentTab } from '../types';
import type { ChatAttachment } from '@shared/types';

export type AgentTabType = AgentTab;

export interface PendingMedia {
  /** Session the images should attach to (null = whichever composer consumes next). */
  sessionId: string | null;
  items: ChatAttachment[];
  nonce: number;
}

interface AgentUiStore {
  tab: AgentTabType;
  inspectorOpen: boolean;
  selectedChange: Record<string, string>;
  pendingMedia: PendingMedia | null;
  setTab(tab: AgentTabType): void;
  selectChange(sessionId: string, path: string): void;
  openChange(sessionId: string, path: string): void;
  toggleInspector(): void;
  setInspectorOpen(open: boolean): void;
  queueMedia(items: ChatAttachment[], sessionId?: string | null): void;
  consumeMedia(): void;
}

export const useAgentUiStore = create<AgentUiStore>()((set) => ({
  tab: 'artifacts',
  inspectorOpen: true,
  selectedChange: {},
  pendingMedia: null,
  setTab: (tab) => set({ tab }),
  selectChange: (sessionId, path) =>
    set((state) => ({ selectedChange: { ...state.selectedChange, [sessionId]: path } })),
  openChange: (sessionId, path) =>
    set((state) => ({
      tab: 'changes',
      inspectorOpen: true,
      selectedChange: { ...state.selectedChange, [sessionId]: path },
    })),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  queueMedia: (items, sessionId = null) =>
    set(() =>
      items.length > 0
        ? { pendingMedia: { sessionId, items, nonce: Date.now() } }
        : { pendingMedia: null },
    ),
  consumeMedia: () => set({ pendingMedia: null }),
}));
