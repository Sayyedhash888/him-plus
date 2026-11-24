import React, { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { AgentMode } from './components/agent/AgentMode';
import { IdeMode } from './components/ide/IdeMode';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';
import { QuickOpen } from './components/QuickOpen';
import { Button, Toasts } from './components/ui';
import { BrandBanner, BrandMark } from './components/Brand';
import { bootstrap, toggleMode } from './lib/actions';
import { useCoreStore } from './store/core';
import { useConfigStore } from './store/config';
import { useEditorStore } from './store/editor';
import { applyThemeCss, getTheme, monacoThemeName } from './lib/themes';
import { monaco } from './lib/monaco-setup';
import { useKeyboardSound } from './lib/useKeyboardSound';
import { useDebugStore } from './store/debug';
import { useJupyterStore } from './store/jupyter';
import { registerLspProviders } from './lib/lspMonaco';
import { extractImagePath } from './lib/imagePath';
import {
  attachImageFilesToActiveSession,
  filesFromDataTransfer,
  imageFilesFrom,
  importImagePathsToActiveSession,
} from './lib/mediaDrop';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[HIM+] renderer error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="w-full max-w-[520px] rounded-xl border border-coral/20 bg-ink-800 p-6 shadow-panel">
            <div className="font-mono text-[12px] font-semibold text-accent">HIM+</div>
            <h1 className="mt-3 text-[15px] font-semibold text-mist-bright">
              The interface hit an unexpected error
            </h1>
            <p className="mt-2 break-word text-[11px] leading-relaxed text-mist-faint">
              {this.state.error.message}
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                Reload window
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => this.setState({ error: null })}
              >
                Try to continue
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function BootSplash() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ink-900">
      <div className="hairline-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        <BrandBanner className="w-[380px] max-w-[78vw] rounded-xl border border-line-strong/70 shadow-panel" />
        <div className="mt-8 flex items-center gap-1.5">
          <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent" />
          <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent [animation-delay:180ms]" />
          <span className="h-1 w-1 animate-pulse-soft rounded-full bg-accent [animation-delay:360ms]" />
        </div>
        <div className="mt-2 font-mono text-[9px] tracking-[0.05em] text-mist-ghost">
          loading local workspace state
        </div>
      </div>
      <div className="relative flex items-center justify-between px-4 pb-3 font-mono text-[8px] uppercase tracking-[0.18em] text-mist-ghost">
        <span>Local · BYOK</span>
        <span>v0.1.0</span>
      </div>
    </div>
  );
}

function BootFailure({ message }: { message: string }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-ink-900 p-8">
      <div className="hairline-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative w-full max-w-[540px] rounded-xl border border-line-strong bg-ink-800 p-6 shadow-panel">
        <div className="flex items-center gap-2">
          <BrandMark size={26} alt="" />
          <span className="text-[13px] font-semibold text-mist-bright">HIM+ failed to initialize</span>
        </div>
        <p className="mt-3 break-word text-[11px] leading-relaxed text-coral-soft">{message}</p>
        <p className="mt-2 text-[10px] leading-relaxed text-mist-faint">
          Check that the app can read its local config file, then reload. Your provider keys are
          stored on this machine.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(message)}
          >
            Copy error
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const booted = useCoreStore((state) => state.booted);
  const bootError = useCoreStore((state) => state.bootError);
  const mode = useCoreStore((state) => state.mode);
  const themeId = useConfigStore((state) => state.config?.prefs.theme);
  const keyboardSound = useConfigStore(
    (state) => state.config?.prefs.keyboardSound !== false,
  );
  const [droppingFiles, setDroppingFiles] = useState(false);
  useKeyboardSound(keyboardSound);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    registerLspProviders();
    useDebugStore.getState().initListeners();
    void useJupyterStore.getState().load();
  }, []);

  useEffect(() => {
    if (!themeId) return;
    const theme = getTheme(themeId);
    applyThemeCss(theme);
    monaco.editor.setTheme(monacoThemeName(theme));
  }, [themeId]);

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types || []).includes('Files');

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDroppingFiles(true);
    };

    const onDrop = (event: DragEvent) => {
      setDroppingFiles(false);
      if (!hasFiles(event)) return;
      const images = imageFilesFrom(filesFromDataTransfer(event.dataTransfer));
      // Only claim image drops; other files keep whatever behaviour they had.
      if (images.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      void attachImageFilesToActiveSession(images);
    };

    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.closest(
        'textarea, input, [contenteditable="true"], [contenteditable=""]',
      );
      // Text fields handle their own paste (composer converts images/paths itself).
      if (editable) return;
      const images = imageFilesFrom(filesFromDataTransfer(event.clipboardData));
      if (images.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void attachImageFilesToActiveSession(images);
        return;
      }
      const text = event.clipboardData?.getData('text/plain') || '';
      if (extractImagePath(text)) {
        event.preventDefault();
        event.stopPropagation();
        void importImagePathsToActiveSession([text]);
      }
    };

    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (useCoreStore.getState().mode === 'ide') {
        if (event.key === 'F5') {
          event.preventDefault();
          event.stopPropagation();
          const debug = useDebugStore.getState();
          if (event.shiftKey) void debug.stop();
          else if (debug.status === 'stopped') void debug.step('continue');
          else void debug.start();
          return;
        }
        if (event.key === 'F9') {
          event.preventDefault();
          event.stopPropagation();
          const editor = useEditorStore.getState();
          const tab = editor.tabs.find((item) => item.path === editor.activePath);
          if (tab && (!tab.kind || tab.kind === 'text')) {
            useDebugStore.getState().toggleBreakpoint(tab.path, editor.cursor.line);
          }
          return;
        }
        if (event.key === 'F10') {
          event.preventDefault();
          event.stopPropagation();
          void useDebugStore.getState().step('next');
          return;
        }
        if (event.key === 'F11') {
          event.preventDefault();
          event.stopPropagation();
          void useDebugStore.getState().step(event.shiftKey ? 'stepOut' : 'stepIn');
          return;
        }
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        event.stopPropagation();
        toggleMode();
        return;
      }
      if (mod && event.key === ',') {
        event.preventDefault();
        event.stopPropagation();
        useCoreStore.getState().setSettingsOpen(true);
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        event.stopPropagation();
        useCoreStore.getState().setQuickOpen(true);
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        if (useCoreStore.getState().mode === 'ide') {
          event.preventDefault();
          event.stopPropagation();
          void useEditorStore.getState().save();
        }
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'j') {
        if (useCoreStore.getState().mode === 'ide') {
          event.preventDefault();
          event.stopPropagation();
          const editor = useEditorStore.getState();
          if (!editor.bottomOpen) editor.setBottomOpen(true);
          else editor.setBottomOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  if (!booted) return <BootSplash />;
  if (bootError) return <BootFailure message={bootError} />;

  return (
    <AppErrorBoundary>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-ink-900 text-mist-bright">
        <TopBar />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className={mode === 'agent' ? 'h-full' : 'hidden'} aria-hidden={mode !== 'agent'}>
            <AgentMode />
          </div>
          <div className={mode === 'ide' ? 'h-full' : 'hidden'} aria-hidden={mode !== 'ide'}>
            <IdeMode active={mode === 'ide'} />
          </div>
        </main>
        <StatusBar />
        <SettingsModal />
        <QuickOpen />
        {droppingFiles && (
          <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-ink-950/40 backdrop-blur-[1px]">
            <div className="flex items-center gap-2.5 rounded-xl border-2 border-dashed border-accent/40 bg-ink-850/95 px-6 py-4 shadow-panel">
              <ImagePlus size={18} className="text-accent" />
              <div className="text-left">
                <div className="text-[12px] font-medium text-mist-bright">
                  Drop images to attach them
                </div>
                <div className="mt-0.5 text-[9px] text-mist-faint">
                  They go to the active agent chat, ready to send.
                </div>
              </div>
            </div>
          </div>
        )}
        <Toasts />
      </div>
    </AppErrorBoundary>
  );
}
