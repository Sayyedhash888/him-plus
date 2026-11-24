import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AcpAuthMethod,
  AcpFsReadRequest,
  AcpFsWriteRequest,
  AcpModelOption,
  AcpPermissionOption,
  AcpPermissionRequest,
  AcpPromptCapabilities,
  AcpPromptImage,
  AcpSessionModels,
  AcpSessionUpdate,
  AcpUsage,
} from '../shared/acp';

export type AcpServerUpdate = AcpSessionUpdate;

/** Extracts token usage from ACP prompt results (agents differ in naming). */
export function parseAcpUsage(result: Record<string, unknown>): AcpUsage | undefined {
  const candidates = [result?.usage, result?.tokenUsage, result?.usageMetadata].filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  );
  for (const raw of candidates) {
    const input =
      numberField(raw, 'inputTokens') ??
      numberField(raw, 'promptTokens') ??
      numberField(raw, 'input_tokens') ??
      numberField(raw, 'prompt_tokens');
    const output =
      numberField(raw, 'outputTokens') ??
      numberField(raw, 'completionTokens') ??
      numberField(raw, 'output_tokens') ??
      numberField(raw, 'completion_tokens');
    const total =
      numberField(raw, 'totalTokens') ??
      numberField(raw, 'total_tokens') ??
      (input !== undefined || output !== undefined
        ? (input || 0) + (output || 0)
        : undefined);
    if (input !== undefined || output !== undefined || total !== undefined) {
      return { inputTokens: input, outputTokens: output, totalTokens: total };
    }
  }
  return undefined;
}

function numberField(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface AcpClientOptions {
  onUpdate(update: AcpSessionUpdate): void;
  requestPermission(
    request: AcpPermissionRequest,
  ): Promise<{ optionId: string } | 'cancelled'>;
  readTextFile?(request: AcpFsReadRequest): Promise<string>;
  writeTextFile?(request: AcpFsWriteRequest): Promise<void>;
  onLog?(message: string, stream: 'stdout' | 'stderr'): void;
}

export interface AcpStartSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  shell?: boolean;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const INITIALIZE_TIMEOUT_MS = 120_000;
const SESSION_TIMEOUT_MS = 120_000;
const PROMPT_TIMEOUT_MS = 2 * 60 * 60_000;

function parseModelOption(raw: unknown): AcpModelOption | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const modelId =
    typeof item.modelId === 'string'
      ? item.modelId
      : typeof item.value === 'string'
        ? item.value
        : '';
  if (!modelId) return null;
  const name =
    typeof item.name === 'string'
      ? item.name
      : typeof item.label === 'string'
        ? item.label
        : modelId;
  return {
    modelId,
    name: name || modelId,
    description: typeof item.description === 'string' ? item.description : undefined,
  };
}

/**
 * Normalizes both ACP model shapes:
 *  - legacy `models: { currentModelId, availableModels: [{ modelId, name }] }`
 *  - newer `configOptions: [{ id: 'model', currentValue, options: [{ value, name }] }]`
 * Agents differ (OpenCode/Kimchi use configOptions, older adapters use models).
 */
function parseModelsFromPayload(
  payload: Record<string, unknown> | null | undefined,
): AcpSessionModels | null {
  if (!payload) return null;
  const models = payload.models as Record<string, unknown> | undefined;
  if (models && typeof models === 'object' && Array.isArray(models.availableModels)) {
    const availableModels = models.availableModels
      .map(parseModelOption)
      .filter((item): item is AcpModelOption => Boolean(item));
    if (availableModels.length > 0) {
      return {
        currentModelId:
          typeof models.currentModelId === 'string' ? models.currentModelId : null,
        availableModels,
      };
    }
  }
  const configOptions = Array.isArray(payload.configOptions) ? payload.configOptions : [];
  for (const rawOption of configOptions) {
    if (!rawOption || typeof rawOption !== 'object') continue;
    const option = rawOption as Record<string, unknown>;
    const configId =
      typeof option.id === 'string'
        ? option.id
        : typeof option.configId === 'string'
          ? option.configId
          : '';
    const optionName = typeof option.name === 'string' ? option.name : '';
    const category = typeof option.category === 'string' ? option.category : '';
    const isModel =
      configId === 'model' ||
      category === 'model' ||
      /^model$/i.test(optionName) ||
      /^model\b/i.test(optionName);
    if (!isModel) continue;
    const values = Array.isArray(option.options) ? option.options : [];
    const availableModels = values
      .map(parseModelOption)
      .filter((item): item is AcpModelOption => Boolean(item));
    if (availableModels.length === 0) continue;
    const currentValue =
      typeof option.currentValue === 'string'
        ? option.currentValue
        : typeof option.value === 'string'
          ? option.value
          : null;
    return { currentModelId: currentValue, availableModels, configId: configId || 'model' };
  }
  return null;
}

export class AcpClient {
  private readonly options: AcpClientOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stderrBuffer = '';
  private stderrTail: string[] = [];
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private sessions = new Map<string, string>();
  private sessionPayloads = new Map<string, Record<string, unknown>>();
  private capabilities: AcpPromptCapabilities = {};
  private authMethods: AcpAuthMethod[] = [];
  private disposed = false;

  constructor(options: AcpClientOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return Boolean(this.child && !this.disposed);
  }

  /** Last stderr lines from the agent, for actionable error messages. */
  lastStderr(): string {
    return this.stderrTail.slice(-14).join('\n').slice(-2400);
  }

  async start(spec: AcpStartSpec): Promise<void> {
    if (this.child) return;
    if (!spec.command.trim()) throw new Error('ACP command is empty.');
    this.disposed = false;
    try {
      this.child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        shell: spec.shell === true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(
        `Could not start the ACP agent "${spec.command}": ${(error as Error).message}`,
      );
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => this.handleStderr(chunk));
    this.child.on('error', (error) => {
      this.options.onLog?.(error.message, 'stderr');
      this.stderrTail.push(error.message);
      this.failPending(
        new Error(`ACP process failed: ${error.message}${this.stderrSuffix()}`),
      );
    });
    this.child.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`;
      this.failPending(new Error(`ACP agent disconnected (${reason}).${this.stderrSuffix()}`));
      this.child = null;
    });

    try {
      const result = (await this.request(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
          },
          clientInfo: {
            name: 'him-plus',
            title: 'HIM+',
            version: '0.1.0',
          },
        },
        INITIALIZE_TIMEOUT_MS,
      )) as Record<string, unknown>;
      const version = Number(result?.protocolVersion);
      if (!Number.isFinite(version) || version < 1) {
        throw new Error('ACP agent returned an unsupported protocol version.');
      }
      const agentCapabilities =
        result?.agentCapabilities && typeof result.agentCapabilities === 'object'
          ? (result.agentCapabilities as Record<string, unknown>)
          : {};
      const promptCapabilities =
        agentCapabilities.promptCapabilities &&
        typeof agentCapabilities.promptCapabilities === 'object'
          ? (agentCapabilities.promptCapabilities as Record<string, unknown>)
          : {};
      this.capabilities = {
        image: promptCapabilities.image === true,
        audio: promptCapabilities.audio === true,
        embeddedContext: promptCapabilities.embeddedContext === true,
      };
      const rawAuthMethods = Array.isArray(agentCapabilities.authMethods)
        ? (agentCapabilities.authMethods as unknown[])
        : Array.isArray(result?.authMethods)
          ? (result.authMethods as unknown[])
          : [];
      this.authMethods = rawAuthMethods
        .map((raw): AcpAuthMethod | null => {
          if (!raw || typeof raw !== 'object') return null;
          const method = raw as Record<string, unknown>;
          const id =
            typeof method.id === 'string'
              ? method.id
              : typeof method.methodId === 'string'
                ? method.methodId
                : '';
          if (!id) return null;
          return {
            id,
            name: typeof method.name === 'string' ? method.name : id,
            description:
              typeof method.description === 'string' ? method.description : undefined,
          };
        })
        .filter((method): method is AcpAuthMethod => method !== null);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Prompt modalities the agent advertised during initialize. */
  getPromptCapabilities(): AcpPromptCapabilities {
    return { ...this.capabilities };
  }

  /** Sign-in flows the agent advertised during initialize. */
  getAuthMethods(): AcpAuthMethod[] {
    return this.authMethods.map((method) => ({ ...method }));
  }

  /** Runs the agent's own authentication flow (may open a browser). */
  async authenticate(methodId: string, timeoutMs = 5 * 60_000): Promise<void> {
    await this.request('authenticate', { methodId }, timeoutMs);
  }

  get supportsImages(): boolean {
    return this.capabilities.image === true;
  }

  async newSession(
    cwd: string,
    mcpServers: Array<Record<string, unknown>> = [],
  ): Promise<string> {
    const cached = this.sessions.get(cwd);
    if (cached) return cached;
    const result = (await this.request(
      'session/new',
      { cwd, mcpServers },
      SESSION_TIMEOUT_MS,
    )) as Record<string, unknown>;
    const sessionId = typeof result?.sessionId === 'string' ? result.sessionId : '';
    if (!sessionId) throw new Error('ACP agent did not return a session id.');
    this.sessions.set(cwd, sessionId);
    this.sessionPayloads.set(sessionId, result);
    return sessionId;
  }

  /** Models the agent advertised for this session, if it supports model selection. */
  getSessionModels(sessionId: string): AcpSessionModels | null {
    return parseModelsFromPayload(this.sessionPayloads.get(sessionId));
  }

  /**
   * Switches the model for a live session. Uses `session/set_config_option`
   * when the agent published the model as a config option (current ACP), and
   * the legacy `session/set_model` otherwise.
   */
  async setModel(sessionId: string, modelId: string): Promise<AcpSessionModels | null> {
    const payload = this.sessionPayloads.get(sessionId) || {};
    const state = parseModelsFromPayload(payload);
    if (!state) {
      throw new Error('This ACP agent did not advertise a model list to choose from.');
    }
    if (!state.availableModels.some((model) => model.modelId === modelId)) {
      throw new Error(`The ACP agent does not offer a model with id "${modelId}".`);
    }
    if (state.configId) {
      const result = await this.request(
        'session/set_config_option',
        { sessionId, configId: state.configId, value: modelId },
        SESSION_TIMEOUT_MS,
      );
      if (result && typeof result === 'object') {
        this.sessionPayloads.set(sessionId, {
          ...payload,
          ...(result as Record<string, unknown>),
        });
      }
    } else {
      await this.request(
        'session/set_model',
        { sessionId, modelId },
        SESSION_TIMEOUT_MS,
      );
      const models = payload.models as Record<string, unknown> | undefined;
      this.sessionPayloads.set(sessionId, {
        ...payload,
        models: { ...(models || {}), currentModelId: modelId },
      });
    }
    const next = this.getSessionModels(sessionId);
    return next
      ? { ...next, currentModelId: modelId }
      : { currentModelId: modelId, availableModels: state.availableModels };
  }

  async prompt(
    sessionId: string,
    text: string,
    images: AcpPromptImage[] = [],
  ): Promise<{ stopReason: string; usage?: AcpUsage }> {
    if (images.length > 0 && !this.supportsImages) {
      throw new Error('This ACP agent did not advertise image prompt support.');
    }
    const blocks: Array<Record<string, unknown>> = [];
    if (text.trim()) blocks.push({ type: 'text', text });
    for (const image of images) {
      if (!image?.data || !image.mime) continue;
      blocks.push({ type: 'image', data: image.data, mimeType: image.mime });
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '(empty prompt)' });
    const result = (await this.request(
      'session/prompt',
      {
        sessionId,
        prompt: blocks,
      },
      PROMPT_TIMEOUT_MS,
    )) as Record<string, unknown>;
    return {
      stopReason:
        typeof result?.stopReason === 'string' ? result.stopReason : 'end_turn',
      usage: parseAcpUsage(result),
    };
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }

  private stderrSuffix(): string {
    const tail = this.lastStderr();
    return tail ? `\n${tail}` : '';
  }

  dispose(): void {    this.disposed = true;
    this.failPending(new Error('ACP agent was stopped.'));
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child || this.disposed) {
        reject(new Error('ACP agent is not running.'));
        return;
      }
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child || this.disposed) return;
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch {
      // The exit handler reports a disconnected agent.
    }
  }

  private respond(id: number | string | undefined, result: unknown): void {
    if (id === undefined) return;
    const child = this.child;
    if (!child || this.disposed) return;
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    } catch {
      // ignore
    }
  }

  private respondError(
    id: number | string | undefined,
    code: number,
    message: string,
  ): void {
    if (id === undefined) return;
    const child = this.child;
    if (!child || this.disposed) return;
    try {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`,
      );
    } catch {
      // ignore
    }
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    let newline = this.stderrBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stderrBuffer.slice(0, newline).trim();
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      if (line) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 60) this.stderrTail.shift();
        this.options.onLog?.(line, 'stderr');
      }
      newline = this.stderrBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.options.onLog?.(line, 'stdout');
      return;
    }

    if (message.method) {
      void this.handleAgentRequest(message);
      return;
    }

    if (typeof message.id !== 'number' || !this.pending.has(message.id)) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(message.error.message || `ACP request failed (${message.error.code ?? 'unknown'}).`),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private async handleAgentRequest(message: JsonRpcMessage): Promise<void> {
    const method = message.method || '';
    const params = (message.params || {}) as Record<string, unknown>;
    try {
      if (method === 'session/update') {
        const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
        const update = params.update;
        if (update && typeof update === 'object') {
          const record = update as Record<string, unknown>;
          if (sessionId) {
            const payload = this.sessionPayloads.get(sessionId) || {};
            if (Array.isArray(record.configOptions)) {
              this.sessionPayloads.set(sessionId, {
                ...payload,
                configOptions: record.configOptions,
              });
            } else if (
              record.sessionUpdate === 'current_model_update' &&
              typeof record.modelId === 'string'
            ) {
              const models = payload.models as Record<string, unknown> | undefined;
              this.sessionPayloads.set(sessionId, {
                ...payload,
                models: { ...(models || {}), currentModelId: record.modelId },
              });
            }
          }
          this.options.onUpdate(record as AcpSessionUpdate);
        }
        return;
      }
      if (method === 'session/request_permission') {
        const options = Array.isArray(params.options)
          ? (params.options as AcpPermissionOption[])
          : [];
        const toolCall =
          params.toolCall && typeof params.toolCall === 'object'
            ? (params.toolCall as Record<string, unknown>)
            : {};
        const decision = await this.options.requestPermission({
          sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
          toolCall,
          options,
        });
        if (decision === 'cancelled' || !decision.optionId) {
          this.respond(message.id, { outcome: { outcome: 'cancelled' } });
          return;
        }
        this.respond(message.id, {
          outcome: { outcome: 'selected', optionId: decision.optionId },
        });
        return;
      }
      if (method === 'fs/read_text_file') {
        if (!this.options.readTextFile) {
          this.respondError(message.id, -32601, 'File reads are not supported.');
          return;
        }
        const content = await this.options.readTextFile({
          sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
          path: typeof params.path === 'string' ? params.path : '',
          line: typeof params.line === 'number' ? params.line : null,
          limit: typeof params.limit === 'number' ? params.limit : null,
        });
        this.respond(message.id, { content });
        return;
      }
      if (method === 'fs/write_text_file') {
        if (!this.options.writeTextFile) {
          this.respondError(message.id, -32601, 'File writes are not supported.');
          return;
        }
        await this.options.writeTextFile({
          sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
          path: typeof params.path === 'string' ? params.path : '',
          content: typeof params.content === 'string' ? params.content : '',
        });
        this.respond(message.id, null);
        return;
      }
      this.respondError(message.id, -32601, `Unsupported ACP method: ${method}`);
    } catch (error) {
      this.respondError(
        message.id,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}