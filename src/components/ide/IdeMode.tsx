import { useEditorStore } from '../../store/editor';
import { usePanelSize } from '../../lib/usePanelSize';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { ActivityRail } from './ActivityRail';
import { AiSidebar } from './AiSidebar';
import { BottomDock } from './BottomDock';
import { EditorArea } from './EditorArea';
import { FileExplorer } from './FileExplorer';
import { GitPane } from './GitPane';
import { DebugPane } from './DebugPane';
import { SearchPane } from './SearchPane';

export function IdeMode({ active }: { active: boolean }) {
  const sidebarOpen = useEditorStore((state) => state.sidebarOpen);
  const sidebarView = useEditorStore((state) => state.sidebarView);
  const aiPanelOpen = useEditorStore((state) => state.aiPanelOpen);
  const sidebar = usePanelSize({
    key: 'ide.sidebar',
    initial: 254,
    min: 200,
    max: 560,
    side: 'left',
  });
  const aiPanel = usePanelSize({
    key: 'ide.aiPanel',
    initial: 344,
    min: 280,
    max: 820,
    side: 'right',
  });

  return (
    <div className="flex h-full min-h-0 bg-ink-900">
      <ActivityRail />
      {sidebarOpen && (
        <aside
          style={{ width: sidebar.size }}
          className="shrink-0 border-r border-line"
        >
          {sidebarView === 'explorer' ? (
            <FileExplorer />
          ) : sidebarView === 'git' ? (
            <GitPane />
          ) : sidebarView === 'debug' ? (
            <DebugPane />
          ) : (
            <SearchPane />
          )}
        </aside>
      )}
      {sidebarOpen && (
        <PanelResizeHandle onStart={sidebar.startResize} onReset={sidebar.reset} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <EditorArea active={active} />
        <BottomDock active={active} />
      </div>
      {aiPanelOpen && (
        <PanelResizeHandle onStart={aiPanel.startResize} onReset={aiPanel.reset} />
      )}
      {aiPanelOpen && <AiSidebar active={active} width={aiPanel.size} />}
    </div>
  );
}
