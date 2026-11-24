import { him } from './bridge';
import { useCoreStore } from '../store/core';

const REFRESH_DEBOUNCE_MS = 600;

let unsubscribe: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let activeRoot: string | null = null;

function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const core = useCoreStore.getState();
    core.bumpFs();
    void core.refreshWorkspaceFiles();
    void core.refreshGit();
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * Watches the open workspace so edits made outside HIM+ (another editor, a
 * formatter, a build step, another agent) appear in the explorer, search and
 * git status without a manual refresh.
 */
export async function startWorkspaceWatcher(root: string): Promise<void> {
  if (!root) return;
  stopWorkspaceWatcher();
  activeRoot = root;
  try {
    unsubscribe = him.watch.onChange((event) => {
      if (event.root && event.root !== activeRoot) return;
      scheduleRefresh();
    });
    await him.watch.start(root);
  } catch (error) {
    console.warn('[watcher] could not watch the workspace', error);
    stopWorkspaceWatcher();
  }
}

export function stopWorkspaceWatcher(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  activeRoot = null;
  void him.watch.stop().catch(() => undefined);
}
