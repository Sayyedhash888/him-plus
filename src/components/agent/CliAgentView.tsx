import { useEffect, useMemo, useRef, useState } from 'react';import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ITheme } from '@xterm/xterm';
import {
  AlertTriangle,
  Archive,
  ClipboardPaste,
  CornerDownLeft,
  Eraser,
  MousePointer2,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
} from 'lucide-react';
import type { AgentSession } from '../../types';
import { him } from '../../lib/bridge';
import { cn, uid } from '../../lib/utils';
import { compactCliConversation } from '../../lib/actions';
import {
  clipCliOutput,
  estimateTokens,
  shouldCompactCli,
} from '../../lib/cliTranscript';
import { useConfigStore } from '../../store/config';
import { useSessionStore } from '../../store/sessions';
import { initCliListeners, segmentText, useCliStore } from '../../store/cliSessions';
import { Button, Spinner } from '../ui';

/**
 * Agent CLIs hard-code dark-terminal palettes (truecolor blocks, dim borders),
 * so this terminal stays dark even when HIM+ uses a light theme. Otherwise TUI
 * output is unreadable on a light background.
 */
const CLI_TERMINAL_THEME: ITheme = {
  background: '#0b0e14',
  foreground: '#e7ecf3',
  cursor: '#5fe3e8',
  cursorAccent: '#0b0e14',
  selectionBackground: '#334155',
  black: '#1b2130',
  red: '#f2685f',
  green: '#5ad39a',
  yellow: '#e8c15a',
  blue: '#6cb6ff',
  magenta: '#c792ea',
  cyan: '#5fe3e8',
  white: '#e7ecf3',
  brightBlack: '#5f6b7d',
  brightRed: '#ff8a80',
  brightGreen: '#7ee6b3',
  brightYellow: '#f4d78a',
  brightBlue: '#8fc9ff',
  brightMagenta: '#dbb2ff',
  brightCyan: '#93e9ee',
  brightWhite: '#ffffff',
};

function RawTerminal({
  sessionId,
  focusNonce = 0,
  onLine,
}: {
  sessionId: string;
  focusNonce?: number;
  onLine?(line: string): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const lineBufferRef = useRef('');
  const lineEscapeRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new XTerm({
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 6000,
      theme: CLI_TERMINAL_THEME,
      allowTransparency: false,
      macOptionIsMeta: true,
      disableStdin: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    try {
      fit.fit();
      void him.cliAgent.resize(sessionId, term.cols, term.rows);
    } catch {
      // ignore
    }
    const offData = him.cliAgent.onData(({ sessionId: id, data }) => {
      if (id === sessionId) term.write(data);
    });
    const inputDisposable = term.onData((data) => {
      void him.cliAgent.input(sessionId, data);
      if (!onLine) return;
      let lineBuffer = lineBufferRef.current;
      let lineEscape = lineEscapeRef.current;
      // Best-effort line capture for prompts typed directly into the PTY, so
      // they also land in the persisted session transcript/token estimates.
      for (const char of data) {
        if (lineEscape) {
          if (/[A-Za-z~]/.test(char)) lineEscape = false;
          continue;
        }
        if (char === '\u001b') {
          lineEscape = true;
          lineBuffer = '';
          continue;
        }
        if (char === '\r' || char === '\n') {
          const line = lineBuffer.trim();
          lineBuffer = '';
          if (line.length > 1) onLine(line);
          continue;
        }
        if (char === '\u007f') {
          lineBuffer = lineBuffer.slice(0, -1);
          continue;
        }
        if (char === '\u0003') {
          lineBuffer = '';
          continue;
        }
        if (char >= ' ' && lineBuffer.length < 500) lineBuffer += char;
      }
      lineBufferRef.current = lineBuffer;
      lineEscapeRef.current = lineEscape;
    });
    // Ctrl+V pastes into the PTY explicitly; Electron's menu paste can miss the
    // hidden xterm textarea when the terminal was not focused yet.
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'v'
      ) {
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) void him.cliAgent.input(sessionId, text.replaceAll('\r\n', '\r'));
          })
          .catch(() => undefined);
        return false;
      }
      return true;
    });
    const onResize = () => {
      try {
        fit.fit();
        void him.cliAgent.resize(sessionId, term.cols, term.rows);
      } catch {
        // ignore
      }
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    // Do not steal focus on mount: the chat composer below should be the
    // primary typing surface. Clicking the terminal focuses it as usual.
    return () => {
      observer.disconnect();
      offData();
      inputDisposable.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!focusNonce) return;
    termRef.current?.focus();
  }, [focusNonce]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0b0e14] px-3 py-2"
      onMouseDown={() => termRef.current?.focus()}
      onTouchStart={() => termRef.current?.focus()}
    />
  );
}

export function CliAgentView({ session }: { session: AgentSession }) {
  const config = useConfigStore((state) => state.config);
  const profile = config?.cliAgents.find((item) => item.id === session.cliProfileId) || null;
  const state = useCliStore((store) => store.sessions[session.id]);
  const ensure = useCliStore((store) => store.ensure);
  const addPrompt = useCliStore((store) => store.addPrompt);
  const setStatus = useCliStore((store) => store.setStatus);
  const setError = useCliStore((store) => store.setError);
  const clear = useCliStore((store) => store.clear);
  const [input, setInput] = useState('');
  const [rawOpen, setRawOpen] = useState(true);
  const [focusNonce, setFocusNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const liveAssistantIdRef = useRef<string | null>(null);
  const outputTokensRef = useRef(0);
  const patchTimerRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const hydratedSegmentCountRef = useRef(0);
  const hydratedTailRef = useRef<string | null>(null);
  const sessionStatus = useSessionStoreStatus(session.id);

  const status = state?.status || 'idle';
  const segments = state?.segments || [];
  const running = status === 'running' || status === 'starting';

  const start = async () => {
    if (!profile || !profile.command.trim()) {
      setError(session.id, 'No CLI command configured. Add one in Settings â†’ Integrations â†’ CLI agents.');
      return;
    }
    setBusy(true);
    setStatus(session.id, 'starting');
    // Snapshot before the CLI can mutate the workspace (git workspaces only).
    void him.checkpoint
      .create(session.id, session.workspaceRoot, `Before ${profile.name} run`)
      .catch(() => undefined);
    try {
      const result = await him.cliAgent.start({
        sessionId: session.id,
        command: profile.command,
        args: profile.args,
        cwd: session.workspaceRoot,
        env: profile.env,
      });
      if (!result.ok) {
        setError(session.id, result.error || 'Could not start the CLI agent.');
        return;
      }
      setStatus(session.id, 'running');
    } catch (error) {
      setError(session.id, (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    initCliListeners();
    ensure(session.id);
  }, [session.id, ensure]);

  useEffect(() => {
    // Restore a persisted CLI transcript after an app restart.
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    useCliStore.getState().hydrateFromMessages(
      session.id,
      session.messages
        .filter(
          (message) =>
            message.role === 'user' || message.role === 'assistant' || message.role === 'system',
        )
        .map((message) => ({
          role: message.role as 'user' | 'assistant' | 'system',
          content: message.content,
          compactionNote: message.compactionNote,
        })),
    );
    const restored = useCliStore.getState().sessions[session.id]?.segments || [];
    hydratedSegmentCountRef.current = restored.length;
    hydratedTailRef.current =
      restored.length > 0 ? segmentText(restored[restored.length - 1]) : null;
  }, [session.id, session.messages]);

  const finalizeLiveAssistant = () => {
    const messageId = liveAssistantIdRef.current;
    if (!messageId) return;
    const segments = useCliStore.getState().sessions[session.id]?.segments || [];
    const tail = segments.length > 0 ? segmentText(segments[segments.length - 1]) : '';
    if (tail) {
      useSessionStore
        .getState()
        .patchMessage(session.id, messageId, { content: clipCliOutput(tail), streaming: false });
    } else {
      useSessionStore.getState().patchMessage(session.id, messageId, { streaming: false });
    }
    liveAssistantIdRef.current = null;
    outputTokensRef.current = 0;
    const current = useSessionStore.getState().sessions.find((item) => item.id === session.id);
    if (current && shouldCompactCli(
      current.messages
        .filter(
          (message) =>
            message.role === 'user' || message.role === 'assistant' || message.role === 'system',
        )
        .map((message) => ({
          role: message.role as 'user' | 'assistant' | 'system',
          content: message.content,
          compactionNote: message.compactionNote,
        })),
    )) {
      compactCliConversation(session.id, { silent: true });
    }
  };

  // Mirror the PTY state into the agent session so the sidebar/header show it.
  useEffect(() => {
    const store = useSessionStore.getState();
    if (status === 'running' || status === 'starting') {
      store.setStatus(session.id, 'running');
    } else if (status === 'exited') {
      store.setStatus(session.id, state?.exitCode === 0 ? 'completed' : 'stopped');
    } else if (status === 'error') {
      store.setStatus(session.id, 'error', state?.error);
    }
  }, [status, session.id, state?.exitCode, state?.error]);

  useEffect(() => {
    if (startedRef.current || !profile) return;
    if ((useCliStore.getState().sessions[session.id]?.status || 'idle') === 'idle') {
      startedRef.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, session.id]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [segments.length, status]);

  useEffect(() => {
    // Switching back to the transcript returns focus to the message box.
    if (!rawOpen) composerRef.current?.focus();
  }, [rawOpen]);

  const sendRaw = (data: string) => {
    void him.cliAgent.input(session.id, data);
    setFocusNonce((value) => value + 1);
  };

  const pasteToTerminal = () => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) sendRaw(text.replaceAll('\r\n', '\r'));
      })
      .catch(() => undefined);
  };

  const appendMirrorMessage = (
    role: 'user' | 'assistant',
    content: string,
    streaming = false,
  ): string => {
    const id = uid('msg');
    useSessionStore.getState().appendMessage(session.id, {
      id,
      role,
      content,
      createdAt: Date.now(),
      streaming,
    });
    return id;
  };

  const mirrorTerminalLine = (text: string): void => {
    const line = text.trim();
    if (!line) return;
    finalizeLiveAssistant();
    appendMirrorMessage('user', line);
    useSessionStore
      .getState()
      .addUsage(session.id, { input: estimateTokens(line), output: 0, estimated: true });
    liveAssistantIdRef.current = appendMirrorMessage('assistant', '', true);
    outputTokensRef.current = 0;
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    if (status !== 'running') {
      setError(session.id, 'The CLI process is not running. Press Restart.');
      return;
    }
    // Finalize the previous turn, then mirror this prompt into the session so it
    // persists in SQLite and counts towards context/token estimates.
    finalizeLiveAssistant();
    appendMirrorMessage('user', text);
    useSessionStore
      .getState()
      .addUsage(session.id, { input: estimateTokens(text), output: 0, estimated: true });
    liveAssistantIdRef.current = appendMirrorMessage('assistant', '', true);
    outputTokensRef.current = 0;
    addPrompt(session.id, text);
    void him.cliAgent.input(session.id, `${text}\r`);
    setInput('');
  };

  const compressContext = () => {
    finalizeLiveAssistant();
    compactCliConversation(session.id);
  };

  const stop = async () => {
    finalizeLiveAssistant();
    await him.cliAgent.stop(session.id).catch(() => undefined);
    setStatus(session.id, 'exited', null);
  };

  const restart = async () => {
    await stop();
    startedRef.current = true;
    void start();
  };

  const copyTranscript = () => {
    const text = segments
      .map((segment) => `${segment.prompt ? `> ${segment.prompt}\n\n` : ''}${segmentText(segment)}`)
      .join('\n\n');
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const output = useMemo(
    () => segments.map((segment) => ({ ...segment, text: segmentText(segment) })),
    [segments],
  );

  const latestOutput = output.length > 0 ? output[output.length - 1].text : '';

  useEffect(() => {
    // Mirror live terminal output into the persisted assistant message (throttled)
    // and update estimated output tokens. PTYs expose no provider usage data.
    if (!latestOutput) return;
    const segmentsNow = useCliStore.getState().sessions[session.id]?.segments || [];
    const isNewOutput =
      segmentsNow.length > hydratedSegmentCountRef.current ||
      latestOutput !== hydratedTailRef.current;
    if (!liveAssistantIdRef.current) {
      if (!isNewOutput || status !== 'running') return;
      // Output arrived without a tracked prompt (e.g. typed straight into the
      // PTY) — start a live assistant message so tokens/persistence still work.
      liveAssistantIdRef.current = appendMirrorMessage('assistant', '', true);
      outputTokensRef.current = 0;
    }
    if (patchTimerRef.current) window.clearTimeout(patchTimerRef.current);
    patchTimerRef.current = window.setTimeout(() => {
      const messageId = liveAssistantIdRef.current;
      if (!messageId) return;
      useSessionStore.getState().patchMessage(session.id, messageId, {
        content: clipCliOutput(latestOutput),
      });
      const tokens = estimateTokens(latestOutput);
      const delta = Math.max(0, tokens - outputTokensRef.current);
      if (delta > 0) {
        outputTokensRef.current = tokens;
        useSessionStore
          .getState()
          .addUsage(session.id, { input: 0, output: delta, estimated: true });
      }
    }, 120);
    return () => {
      if (patchTimerRef.current) window.clearTimeout(patchTimerRef.current);
    };
  }, [latestOutput, session.id]);

  useEffect(() => {
    if (status === 'exited' || status === 'error') finalizeLiveAssistant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[10px] font-medium text-mist-bright">
          {profile?.name || 'CLI agent'}
        </span>
        <span className="rounded border border-accent/20 bg-accent/[0.05] px-1 py-px font-mono text-[7px] uppercase tracking-wide text-accent-soft">
          CLI
        </span>
        <span
          className={cn(
            'flex items-center gap-1 font-mono text-[8.5px]',
            status === 'running'
              ? 'text-mint'
              : status === 'error' || status === 'exited'
                ? 'text-coral-soft'
                : 'text-mist-ghost',
          )}
        >
          {status === 'running' && <Spinner size={8} />}
          {status === 'idle' ? 'ready' : status}
          {status === 'exited' && state?.exitCode != null ? ` (code ${state.exitCode})` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            icon={<TerminalSquare size={9} />}
            onClick={() => {
              if (rawOpen) {
                setRawOpen(false);
              } else {
                setRawOpen(true);
                setFocusNonce((value) => value + 1);
              }
            }}
            title={
              rawOpen
                ? 'Experimental text extraction - full-screen TUIs render correctly in Terminal'
                : 'Show the real terminal (recommended for full-screen CLIs)'
            }
          >
            {rawOpen ? 'Transcript' : 'Terminal'}
          </Button>
          {rawOpen && (
            <>
              <Button
                size="xs"
                variant="ghost"
                icon={<MousePointer2 size={9} />}
                onClick={() => setFocusNonce((value) => value + 1)}
                title="Focus the terminal so keystrokes go to the CLI"
              >
                Focus
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<ClipboardPaste size={9} />}
                onClick={pasteToTerminal}
                title="Paste clipboard into the terminal (Ctrl+V also works)"
              >
                Paste
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => sendRaw('\u0003')}
                title="Send Ctrl+C (interrupt the CLI)"
              >
                Ctrl+C
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => sendRaw('\u001b')}
                title="Send Escape (dismiss a TUI menu)"
              >
                Esc
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<CornerDownLeft size={9} />}
                onClick={() => sendRaw('\r')}
                title="Send Enter to the CLI"
              />
            </>
          )}
          <Button
            size="xs"
            variant="ghost"
            icon={<Eraser size={9} />}
            onClick={() => clear(session.id)}
            title="Clear transcript"
          >
            Clear
          </Button>
          <Button size="xs" variant="ghost" onClick={copyTranscript} title="Copy transcript">
            Copy
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<Archive size={9} />}
            onClick={compressContext}
            title="Summarize earlier CLI turns locally to keep long sessions usable"
          >
            Compress
          </Button>
          {running ? (
            <Button size="xs" variant="ghost" icon={<Square size={8} />} onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                variant="outline"
                icon={<Play size={8} />}
                loading={busy}
                onClick={() => void start()}
              >
                Start
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<RotateCcw size={8} />}
                onClick={() => void restart()}
              >
                Restart
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mx-3 mt-2 flex items-start gap-2 rounded border border-sand/25 bg-sand/[0.035] px-2.5 py-1.5 text-[8.5px] leading-relaxed text-sand-soft">
        <AlertTriangle size={10} className="mt-0.5 shrink-0" />
        <span>
          {profile?.name || 'The CLI'} runs directly in a real terminal (PTY). HIM+ approvals,
          Review mode and diff review do not apply â€” the CLI uses its own tools and permissions.
          Interactive screens belong in <strong>Terminal</strong>; <strong>Transcript</strong> is
          best-effort text extraction for line-oriented CLIs and is unreliable for full-screen TUIs.
        </span>
      </div>

      {rawOpen ? (
        <div className="min-h-0 flex-1">
          <RawTerminal
            sessionId={session.id}
            focusNonce={focusNonce}
            onLine={mirrorTerminalLine}
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {state?.error && (
            <div className="mb-3 rounded border border-coral/25 bg-coral-deep/15 px-2.5 py-2 text-[9px] leading-relaxed text-coral-soft">
              {state.error}
            </div>
          )}
          {segments.length === 0 && (
            <div className="mt-10 flex flex-col items-center gap-2 text-center">
              <TerminalSquare size={18} className="text-mist-faint" />
              <div className="text-[10px] font-medium text-mist">
                {running ? 'Starting the CLIâ€¦' : 'CLI agent is idle'}
              </div>
              <p className="max-w-[420px] text-[9px] leading-relaxed text-mist-ghost">
                Transcript is experimental text extraction. Full-screen TUIs (Freebuff and similar)
                render correctly only in <strong>Terminal</strong> â€” switch back using the button
                above.
              </p>
            </div>
          )}
          <div className="space-y-2">
            {output.map((segment) => (
              <div key={segment.id}>
                {segment.prompt && (
                  <div className="mb-1.5 flex justify-end">
                    <div className="max-w-[78%] rounded-lg rounded-br-sm border border-accent/20 bg-accent/[0.07] px-3 py-1.5 text-[10px] leading-relaxed whitespace-pre-wrap text-mist-bright">
                      {segment.prompt}
                    </div>
                  </div>
                )}
                {segment.text && (
                  <pre className="thin-scrollbar overflow-x-auto whitespace-pre-wrap break-words rounded border border-line/60 bg-ink-950/70 px-2.5 py-2 font-mono text-[10px] leading-[1.55] text-mist-dim">
                    {segment.text}
                  </pre>
                )}
              </div>
            ))}
          </div>
          {running && (
            <div className="mt-2 flex items-center gap-1.5 text-[8.5px] text-mist-ghost">
              <Spinner size={8} /> {profile?.name || 'CLI'} is attached to this session
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-ink-950/60 px-2 py-1.5 focus-within:border-accent/40">
            <textarea
              ref={composerRef}
              autoFocus
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Don't submit while an IME (emoji/Japanese input) is composing.
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={
                running
                  ? `Message ${profile?.name || 'CLI'}... (Enter to send)`
                  : 'Start the CLI agent to send messages'
              }
              disabled={!running}
              className="max-h-32 min-h-[22px] flex-1 resize-none bg-transparent py-0.5 font-mono text-[10.5px] leading-relaxed text-mist-bright outline-none placeholder:text-mist-ghost disabled:opacity-50"
            />
            <Button
              size="xs"
              variant="primary"
              disabled={!running || !input.trim()}
              onClick={send}
            >
              Send
            </Button>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[8px] text-mist-ghost">
            <span>
              Enter sends a line - Shift+Enter adds a newline - click the terminal to type into{' '}
              {profile?.name || 'the CLI'} directly
            </span>
            <span className="ml-auto">
              {sessionStatus === 'error' ? 'session error' : `session: ${sessionStatus}`}
            </span>
          </div>
        </div>
      </div>
  );
}

function useSessionStoreStatus(sessionId: string): string {
  return useCliStore((state) => state.sessions[sessionId]?.status || 'idle');
}

