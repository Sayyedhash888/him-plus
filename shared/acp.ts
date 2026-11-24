import type { AcpAgentProfile } from './types';

export type AcpPermissionMode = 'plan' | 'review' | 'auto';

export interface AcpSessionUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: AcpPermissionOption[];
}

export interface AcpFsReadRequest {
  sessionId: string;
  path: string;
  line?: number | null;
  limit?: number | null;
}

export interface AcpFsWriteRequest {
  sessionId: string;
  path: string;
  content: string;
}

export interface AcpPromptRequest {
  sessionId: string;
  profile: AcpAgentProfile;
  cwd: string;
  permission: AcpPermissionMode;
  prompt: string;
  /** Images to deliver as ACP image content blocks (when the agent supports them). */
  media?: AcpPromptMedia[];
}

export interface AcpPromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

/** Image payload prepared by the main process before it is sent to the agent. */
export interface AcpPromptImage {
  mime: string;
  /** Base64-encoded image bytes (no data URL prefix). */
  data: string;
}

/** A pasted attachment the renderer wants the ACP agent to receive. */
export interface AcpPromptMedia {
  kind: 'image';
  name?: string;
  mime: string;
  /** Absolute path inside the app's attachment store. */
  path?: string;
  /** Fallback data URL when the attachment has not been persisted yet. */
  dataUrl?: string;
}

export interface AcpUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AcpPromptResult {
  ok: boolean;
  stopReason?: string;
  error?: string;
  /** Non-fatal notice, e.g. images dropped because the agent cannot view them. */
  warning?: string;
  /** Token usage when the ACP agent reports it. */
  usage?: AcpUsage;
}

/** One model the ACP agent offers for a session. */
export interface AcpModelOption {
  modelId: string;
  name: string;
  description?: string;
}

/**
 * Model state advertised by an ACP agent for a session.
 * `configId` is set when the agent uses the newer `session/set_config_option`
 * protocol shape instead of the legacy `session/set_model` request.
 */
export interface AcpSessionModels {
  currentModelId: string | null;
  availableModels: AcpModelOption[];
  configId?: string;
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
}

export interface AcpMcpServerLaunch {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Converts HIM+ MCP configs to the ACP `session/new` mcpServers shape. */
export function toAcpMcpServers(
  configs: AcpMcpServerLaunch[],
): Array<{
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}> {
  return configs
    .filter((config) => config.name.trim() && config.command.trim())
    .map((config) => ({
      name: config.name,
      command: config.command,
      args: [...config.args],
      env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
    }));
}

export interface AcpConnectRequest {
  sessionId: string;
  profile: AcpAgentProfile;
  cwd: string;
  permission: AcpPermissionMode;
}

export interface AcpConnectResult {
  ok: boolean;
  error?: string;
  models?: AcpSessionModels | null;
  /** Prompt modalities the agent advertised during initialize. */
  capabilities?: AcpPromptCapabilities;
  /** Set when the agent needs its own sign-in before a session can start. */
  authRequired?: boolean;
  authMethods?: AcpAuthMethod[];
}

export interface AcpSetModelRequest {
  sessionId: string;
  modelId: string;
}

export interface AcpFileChange {
  path: string;
  before: string;
  after: string;
}

export type AcpStreamEvent =
  | {
      sessionId: string;
      type: 'update';
      update: AcpSessionUpdate;
    }
  | {
      sessionId: string;
      type: 'file';
      change: AcpFileChange;
    }
  | {
      sessionId: string;
      type: 'log';
      message: string;
      stream: 'stdout' | 'stderr';
    }
  | {
      sessionId: string;
      type: 'done';
      stopReason: string;
    }
  | {
      sessionId: string;
      type: 'error';
      message: string;
    };