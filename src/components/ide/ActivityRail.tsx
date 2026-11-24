import { Bot, Bug, FolderTree, GitBranch, Search, Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useEditorStore } from '../../store/editor';
import { useCoreStore } from '../../store/core';
import { switchMode } from '../../lib/actions';
import type { ReactNode } from 'react';

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-ink-800 text-accent shadow-inset'
          : 'text-mist-faint hover:bg-ink-800/60 hover:text-mist',
      )}
    >
      {active && (
        <span className="absolute -left-[5px] top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
      )}
      {children}
    </button>
  );
}

export function ActivityRail() {
  const sidebarView = useEditorStore((state) => state.sidebarView);
  const sidebarOpen = useEditorStore((state) => state.sidebarOpen);
  const setSidebarView = useEditorStore((state) => state.setSidebarView);
  const setSidebarOpen = useEditorStore((state) => state.setSidebarOpen);
  const setSettingsOpen = useCoreStore((state) => state.setSettingsOpen);

  const openView = (view: 'explorer' | 'search' | 'git' | 'debug') => {
    if (sidebarOpen && sidebarView === view) {
      setSidebarOpen(false);
      return;
    }
    setSidebarView(view);
    setSidebarOpen(true);
  };

  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-ink-950/60 py-1.5">
      <RailButton
        active={sidebarOpen && sidebarView === 'explorer'}
        label="Explorer"
        onClick={() => openView('explorer')}
      >
        <FolderTree size={16} strokeWidth={1.7} />
      </RailButton>
      <RailButton
        active={sidebarOpen && sidebarView === 'search'}
        label="Search"
        onClick={() => openView('search')}
      >
        <Search size={16} strokeWidth={1.7} />
      </RailButton>
      <RailButton
        active={sidebarOpen && sidebarView === 'git'}
        label="Source control"
        onClick={() => openView('git')}
      >
        <GitBranch size={16} strokeWidth={1.7} />
      </RailButton>
      <RailButton
        active={sidebarOpen && sidebarView === 'debug'}
        label="Run and Debug"
        onClick={() => openView('debug')}
      >
        <Bug size={16} strokeWidth={1.7} />
      </RailButton>
      <div className="my-2 h-px w-5 bg-line" />
      <RailButton
        label="Open Agent Mode"
        onClick={() => switchMode('agent')}
      >
        <Bot size={16} strokeWidth={1.7} />
      </RailButton>
      <div className="flex-1" />
      <RailButton
        label="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 size={15} strokeWidth={1.7} />
      </RailButton>
    </div>
  );
}
