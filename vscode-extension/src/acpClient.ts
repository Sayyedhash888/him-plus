import { spawn, type ChildProcess } from 'node:child_process';
import type { HimAgentProfile } from './himConfig';

/**
 * A focused ACP (Agent Client Protocol) client for the extension host.
 *
 * Ported in spirit from `electron/acpClient.ts`, which cannot be imported here:
 * it types itself against `shared/acp`, and more importantly it carries the
 * desktop's full surface (model catalogs, config options, fs callbacks). What the
 * extension needs is the core turn loop:
 *
 *   initialize  →  session/new  →  session/prompt  (stream session/update)
 *
 * plus `session/request_permission`, which is where an agent asks to do something
 * risky. That one must reach the user: silently denying it would make every ACP
 * agent appear broken, and silently allowing it would defeat the point of asking.
 *
 * A visible difference from the desktop: **there is no PTY**. The extension host
 * cannot load `node-pty`, and ACP is line-delimited JSON-RPC on stdio, so pipes
 * are the correct transport here rather than a limitation.
 */

const INITIALIZE_TIMEOUT_MS = 120_000;
const SESSION_TIMEOUT_MS = 120_000;
/** One agent turn can legitimately run for a long time. */
const PROMPT_TIMEOUT_MS = 30 * 60_000;

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface AcpUpdate {
  /** Raw `session/update` payload; the renderer decides how to show it. */
  sessionUpdate?: string;
  content?: { type?: string; text?: string } | null;
  [key: string]: unknown;
}

export interface AcpClientEvents {
  onUpdate(update: AcpUpdate): void;
  /** Ask the user. Returning 'cancelled' makes the agent treat it as declined. */
  requestPermission(request: {
    toolCall?: unknown;
    options?: AcpPermissionOption[];
  }): Promise<{ optionId: string } | 'cancelled'>;
  onLog?(message: string, stream: 'stdout' | 'stderr'): void;
  onExit?(code: number | null): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Windows needs `shell: true` for npm-installed CLIs, which are `.cmd` shims that
 * `spawn` cannot execute directly — the same problem the desktop solves for
 * node-pty (`electron/cliAgent.ts:83-91`). With `shell` the command line is
 * passed through `cmd.exe`, which resolves the shim.
 */
export function agentSpawnSpec(
  profile: Pick<HimAgentProfile, 'command' | 'args'>,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean } {
  return {
    command: profile.command,
    args: profile.args ?? [],
    shell: platform === 'win32' && /\.(cmd|bat)$/i.test(profile.command) === false
      ? false
      : platform === 'win32',
  };
}

export class AcpClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly startedAt = Date.now();
  private buffer = '';
  private disposition: 'running' | 'disposed' | 'exited' = 'running';
  private exitCode: number | null = null;
  private acpSessionId: string | null = null;

  constructor(private readonly events: AcpClientEvents) {}

  get sessionId(): string | null {
    return this.acpSessionId;
  }

  get running(): boolean {
    return this.disposition === 'running' && this.child !== null;
  }

  get exit(): { code: number | null; disposition: string } {
    return { code: this.exitCode, disposition: this.disposition };
  }

  /** Spawns the agent and performs the `initialize` handshake. */
  async start(profile: HimAgentProfile, cwd: string): Promise<void> {
    const spec = agentSpawnSpec(profile);
    const child = spawn(spec.command, spec.args, {
      cwd,
      shell: spec.shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(profile.env || {}) },
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.events.onLog?.(chunk.toString(), 'stderr');
    });
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => {
      this.exitCode = code;
      if (this.disposition === 'running') this.disposition = 'exited';
      this.failAll(new Error(`The agent exited (code ${code ?? 'unknown'}).`));
      this.events.onExit?.(code);
    });

    await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      INITIALIZE_TIMEOUT_MS,
    );
  }

  /** Opens an ACP session rooted at `cwd`. */
  async newSession(cwd: string): Promise<string> {
    const result = (await this.request(
      'session/new',
      { cwd, mcpServers: [] },
      SESSION_TIMEOUT_MS,
    )) as { sessionId?: string } | null;
    const sessionId = result?.sessionId;
    if (!sessionId) throw new Error('The agent did not return a session id.');
    this.acpSessionId = sessionId;
    return sessionId;
  }

  /** Sends one turn and resolves when the agent finishes it. */
  async prompt(text: string): Promise<{ stopReason?: string }> {
    if (!this.acpSessionId) throw new Error('No ACP session. Call newSession() first.');
    const result = (await this.request(
      'session/prompt',
      {
        sessionId: this.acpSessionId,
        prompt: [{ type: 'text', text }],
      },
      PROMPT_TIMEOUT_MS,
    )) as { stopReason?: string } | null;
    return { stopReason: result?.stopReason };
  }

  cancel(): void {
    if (!this.acpSessionId || this.disposition !== 'running') return;
    this.notify('session/cancel', { sessionId: this.acpSessionId });
  }

  dispose(): void {
    if (this.disposition === 'disposed') return;
    this.disposition = 'disposed';
    this.failAll(new Error('The agent was stopped.'));
    try {
      this.child?.kill();
    } catch {
      // already gone
    }
    this.child = null;
  }

  /* ---------------------------------------------------------------- transport */

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Agents may print non-protocol noise on stdout; ignore rather than die.
        this.events.onLog?.(trimmed, 'stdout');
        continue;
      }
      if (typeof message.method === 'string') {
        void this.handleAgentRequest(message);
        continue;
      }
      const id = typeof message.id === 'number' ? message.id : null;
      if (id === null) continue;
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = message.error as { message?: string };
        entry.reject(new Error(error?.message || 'The agent reported an error.'));
      } else {
        entry.resolve(message.result);
      }
    }
  }

  private async handleAgentRequest(message: Record<string, unknown>): Promise<void> {
    const method = String(message.method);
    const id = message.id as number | string | undefined;

    if (method === 'session/update') {
      const params = (message.params || {}) as { update?: AcpUpdate };
      if (params.update) this.events.onUpdate(params.update);
      return;
    }

    if (method === 'session/request_permission') {
      const params = (message.params || {}) as {
        toolCall?: unknown;
        options?: AcpPermissionOption[];
      };
      // A denied or unanswered request must still be answered, or the agent hangs.
      const decision = await this.events.requestPermission(params);
      if (id === undefined) return;
      if (decision === 'cancelled') {
        this.respond(id, { outcome: { outcome: 'cancelled' } });
      } else {
        this.respond(id, {
          outcome: { outcome: 'selected', optionId: decision.optionId },
        });
      }
      return;
    }

    // Refuse unknown server→client calls explicitly so the agent can move on
    // rather than waiting for a reply that never comes.
    if (id !== undefined) {
      this.respondError(id, -32601, `Unsupported ACP method: ${method}`);
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.disposition !== 'running') {
      return Promise.reject(new Error('The ACP client is not running.'));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private respond(id: number | string, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private send(payload: unknown): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
