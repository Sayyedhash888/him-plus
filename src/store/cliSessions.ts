import { create } from 'zustand';
import { him } from '../lib/bridge';
import { appendCliOutput, sanitizeCliOutput } from '../lib/cliTerminal';
import { buildSegmentsFromMessages } from '../lib/cliTranscript';

export type CliSessionStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

export interface CliSegment {
  id: string;
  prompt: string;
  raw: string;
  at: number;
}

export interface CliSessionState {
  status: CliSessionStatus;
  exitCode: number | null;
  error?: string;
  segments: CliSegment[];
}

interface CliStore {
  sessions: Record<string, CliSessionState>;
  ensure(sessionId: string): void;
  addPrompt(sessionId: string, prompt: string): void;
  appendData(sessionId: string, chunk: string): void;
  setStatus(sessionId: string, status: CliSessionStatus, exitCode?: number | null): void;
  setError(sessionId: string, error: string): void;
  clear(sessionId: string): void;
  remove(sessionId: string): void;
  /** Restores the chat transcript from persisted AgentSession messages. */
  hydrateFromMessages(
    sessionId: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; compactionNote?: boolean }>,
  ): void;
}

const empty = (): CliSessionState => ({
  status: 'idle',
  exitCode: null,
  segments: [],
});

let nextId = 1;

export const useCliStore = create<CliStore>()((set, get) => ({
  sessions: {},
  ensure: (sessionId) => {
    if (get().sessions[sessionId]) return;
    set((state) => ({ sessions: { ...state.sessions, [sessionId]: empty() } }));
  },
  addPrompt: (sessionId, prompt) => {
    const current = get().sessions[sessionId] || empty();
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          segments: [
            ...current.segments,
            { id: `seg-${nextId++}`, prompt, raw: '', at: Date.now() },
          ],
        },
      },
    }));
  },
  appendData: (sessionId, chunk) => {
    const current = get().sessions[sessionId] || empty();
    const segments = [...current.segments];
    const last = segments[segments.length - 1];
    if (!last || last.prompt) {
      segments.push({ id: `seg-${nextId++}`, prompt: '', raw: chunk, at: Date.now() });
    } else {
      segments[segments.length - 1] = {
        ...last,
        raw: appendCliOutput(last.raw, chunk),
      };
    }
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: { ...current, segments } },
    }));
  },
  setStatus: (sessionId, status, exitCode = null) => {
    const current = get().sessions[sessionId] || empty();
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...current, status, exitCode: status === 'exited' ? exitCode : null },
      },
    }));
  },
  setError: (sessionId, error) => {
    const current = get().sessions[sessionId] || empty();
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: { ...current, status: 'error', error } },
    }));
  },
  clear: (sessionId) => {
    const current = get().sessions[sessionId] || empty();
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: { ...current, segments: [], error: undefined } },
    }));
  },
  remove: (sessionId) => {
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[sessionId];
      return { sessions };
    });
  },
  hydrateFromMessages: (sessionId, messages) => {
    const current = get().sessions[sessionId];
    if (!current || current.segments.length > 0) return;
    const segments = buildSegmentsFromMessages(messages).map((segment, index) => ({
      id: `seg-restored-${Date.now().toString(36)}-${index}`,
      prompt: segment.prompt,
      raw: segment.raw,
      at: Date.now(),
    }));
    if (segments.length === 0) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...(state.sessions[sessionId] || empty()), segments },
      },
    }));
  },
}));

let initialized = false;

/** Subscribes once to the CLI-agent PTY stream. */
export function initCliListeners(): void {
  if (initialized) return;
  initialized = true;
  him.cliAgent.onData(({ sessionId, data }) => {
    useCliStore.getState().ensure(sessionId);
    useCliStore.getState().appendData(sessionId, data);
  });
  him.cliAgent.onExit(({ sessionId, exitCode }) => {
    useCliStore.getState().ensure(sessionId);
    useCliStore.getState().appendData(
      sessionId,
      `\n[process exited with code ${exitCode ?? 'unknown'}]\n`,
    );
    useCliStore.getState().setStatus(sessionId, 'exited', exitCode);
  });
}

/** Sanitized transcript text for one segment (for display/copy). */
export function segmentText(segment: CliSegment): string {
  return sanitizeCliOutput(segment.raw);
}
