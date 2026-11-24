import { create } from 'zustand';
import type { JupyterLabConfig } from '@shared/types';
import { him } from '../lib/bridge';

interface JupyterStore {
  config: JupyterLabConfig | null;
  loading: boolean;
  error?: string;
  load(): Promise<void>;
}

export const useJupyterStore = create<JupyterStore>()((set, get) => ({
  config: null,
  loading: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: undefined });
    try {
      const config = await him.jupyter.detect();
      set({ config, loading: false });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
    }
  },
}));

/**
 * JupyterLab *behaviour* (line numbers, wrapping, auto-closing brackets) is
 * mirrored when detection succeeded and the user kept the preference on. The
 * visual theme always stays HIM+'s own theme.
 */
export function useJupyterNotebookBehavior(config: {
  prefs?: { matchJupyterNotebook?: boolean } | null;
} | null): JupyterLabConfig | null {
  const jupyter = useJupyterStore((state) => state.config);
  if (!jupyter?.detected) return null;
  if (config?.prefs?.matchJupyterNotebook === false) return null;
  return jupyter;
}
