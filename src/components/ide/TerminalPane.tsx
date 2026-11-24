import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ITheme } from '@xterm/xterm';
import type { TerminalTabInfo } from '../../types';
import { him, cleanErrorMessage } from '../../lib/bridge';
import { cn } from '../../lib/utils';
import { useEditorStore, type TerminalCommandRequest } from '../../store/editor';
import { toast } from '../../store/toast';
import { useAppTheme } from '../../lib/useTheme';
import { xtermTheme } from '../../lib/themes';

export interface TerminalFailure {
  command: string;
  code: number | null;
  output: string;
  cwd: string;
}

const MAX_REMEMBERED_OUTPUT = 40_000;

/**
 * Real terminal: xterm.js is wired directly to a PTY (ConPTY on Windows), so
 * full-screen TUIs, colors, REPLs and interactive prompts work. Input, resize
 * and kill flow through the pty: IPC bridge.
 */
export function TerminalPane({
  terminal,
  isVisible,
  commandRequest,
  onCommandConsumed,
}: {
  terminal: TerminalTabInfo;
  isVisible: boolean;
  onFailure?(failure: TerminalFailure): void;
  commandRequest: Pick<TerminalCommandRequest, 'id' | 'command'> | null;
  onCommandConsumed(id: number): void;
}) {
  const appTheme = useAppTheme();
  const themeRef = useRef<ITheme>(xtermTheme(appTheme) as ITheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const recentOutputRef = useRef('');
  const runCommandRef = useRef<((command: string) => boolean) | null>(null);
  const consumedRef = useRef(onCommandConsumed);
  consumedRef.current = onCommandConsumed;
  const setLastTerminal = useEditorStore((state) => state.setLastTerminal);

  useEffect(() => {
    const next = xtermTheme(appTheme) as ITheme;
    themeRef.current = next;
    if (termRef.current) termRef.current.options.theme = next;
  }, [appTheme.id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const term = new XTerm({
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 11.25,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      theme: themeRef.current,
      allowTransparency: false,
      convertEol: false,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // hidden or sizing before first paint
    }
    term.focus();

    const dataDisposable = term.onData((data) => {
      const id = ptyIdRef.current;
      if (id) void him.pty.input(id, data).catch(() => undefined);
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      const id = ptyIdRef.current;
      if (id) void him.pty.resize(id, cols, rows).catch(() => undefined);
    });
    const unsubscribe = him.pty.onData((event) => {
      if (!ptyIdRef.current || event.id !== ptyIdRef.current) return;
      recentOutputRef.current = `${recentOutputRef.current}${event.chunk}`.slice(
        -MAX_REMEMBERED_OUTPUT,
      );
      term.write(event.chunk);
    });

    const boot = async () => {
      try {
        const created = await him.pty.create(
          terminal.cwd,
          term.cols || 120,
          term.rows || 30,
        );
        if (disposed) {
          void him.pty.dispose(created.id).catch(() => undefined);
          return;
        }
        ptyIdRef.current = created.id;
        void him.pty.resize(created.id, term.cols, term.rows).catch(() => undefined);
        term.focus();
      } catch (error) {
        const message = cleanErrorMessage(error);
        term.writeln(`\x1b[38;2;242;112;112mHIM+ could not start a terminal: ${message}\x1b[0m`);
        toast('error', message, 'Terminal failed');
      }
    };
    void boot();

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // ignore transient layout errors
        }
      });
    });
    observer.observe(container);

    runCommandRef.current = (command: string) => {
      const id = ptyIdRef.current;
      if (!id) return false;
      void him.pty.input(id, `${command}\r`).catch(() => undefined);
      setLastTerminal({
        command,
        cwd: terminal.cwd,
        output: recentOutputRef.current.slice(-MAX_REMEMBERED_OUTPUT),
        code: null,
      });
      return true;
    };

    return () => {
      disposed = true;
      runCommandRef.current = null;
      const id = ptyIdRef.current;
      ptyIdRef.current = null;
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribe();
      observer.disconnect();
      if (id) void him.pty.dispose(id).catch(() => undefined);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminal.id]);

  useEffect(() => {
    if (!commandRequest || !isVisible) return;
    const timer = window.setTimeout(() => {
      const ran = runCommandRef.current?.(commandRequest.command);
      if (!ran) {
        toast('info', 'Terminal is still starting up. Try again in a moment.', 'Terminal');
      }
      consumedRef.current(commandRequest.id);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [commandRequest?.id, isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      termRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isVisible, terminal.id]);

  return (
    <div
      className={cn(
        'terminal-shell relative h-full min-h-0 w-full overflow-hidden',
        isVisible ? 'block' : 'hidden',
      )}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
