import type { ChatAttachment, LlmUsage, ModelRef, NotebookData } from '@shared/types';
import type { AcpSessionModels } from '@shared/acp';

export type PermissionMode = 'plan' | 'review' | 'auto';
export type AgentStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'error' | 'stopped';
export type ToolStatus = 'queued' | 'running' | 'waiting' | 'done' | 'error' | 'rejected';
export type AgentTab = 'artifacts' | 'changes' | 'terminal';

export interface ToolCallMeta {
  path?: string;
  command?: string;
  query?: string;
  added?: number;
  removed?: number;
  exitCode?: number | null;
  preview?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  parsedArgs: Record<string, unknown>;
  native: boolean;
  status: ToolStatus;
  result?: string;
  error?: string;
  meta?: ToolCallMeta;
  startedAt?: number;
  endedAt?: number;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  apiContent?: string;
  /** `@`-mention labels that were expanded into the prompt. */
  attachments?: string[];
  /** Images and files supplied with this message. */
  media?: ChatAttachment[];
  reasoning?: string;
  toolCalls?: ToolCallState[];
  toolCallId?: string;
  toolName?: string;
  nativeToolCalls?: boolean;
  createdAt: number;
  usage?: LlmUsage;
  streaming?: boolean;
  error?: string;
  compactionNote?: boolean;
}

export interface AgentChange {
  path: string;
  absPath: string;
  before: string;
  after: string;
  status: 'pending' | 'accepted' | 'reverted';
  kind: 'added' | 'modified';
  added: number;
  removed: number;
  updatedAt: number;
}

export interface ArtifactComment {
  id: string;
  body: string;
  createdAt: number;
  sent?: boolean;
}

export interface Artifact {
  id: string;
  title: string;
  kind: 'plan' | 'notes' | 'checklist';
  content: string;
  createdAt: number;
  updatedAt: number;
  comments: ArtifactComment[];
}

export interface AgentTerminalRun {
  id: string;
  command: string;
  cwd: string;
  output: string;
  code?: number | null;
  running: boolean;
  startedAt: number;
}

export interface AgentSession {
  id: string;
  title: string;
  status: AgentStatus;
  backend?: 'him' | 'acp' | 'cli';
  acpProfileId?: string | null;
  cliProfileId?: string | null;
  /** Model catalog advertised by the ACP agent for this session, if any. */
  acpModels?: AcpSessionModels | null;
  /** Whether the ACP agent accepts image prompt content (null = not yet known). */
  acpVision?: boolean | null;
  permission: PermissionMode;
  messages: ChatEntry[];
  changes: AgentChange[];
  artifacts: Artifact[];
  terminalRuns: AgentTerminalRun[];
  tokens: {
    input: number;
    output: number;
    cost?: number;
    estimated?: boolean;
  };
  workspaceRoot: string;
  branch?: string | null;
  worktree: { path: string; branch: string } | null;
  model: ModelRef | null;
  createdAt: number;
  updatedAt: number;
  error?: string;
  pendingApproval?: { messageId: string; toolCallId: string } | null;
  lastPrompt?: string;
}

export interface EditorTab {
  path: string;
  name: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  /** 'image' tabs render a preview instead of the text editor. */
  kind?: 'text' | 'image' | 'notebook' | 'diff';
  dataUrl?: string;
  notebook?: NotebookData;
  diffOriginal?: string;
  diffModified?: string;
}

export interface Problem {
  path: string;
  line: number;
  column: number;
  message: string;
  severity: number;
  source?: string;
}

export interface TerminalTabInfo {
  id: string;
  cwd: string;
  shell: string;
  title: string;
}

export interface MentionContext {
  type: 'file' | 'folder' | 'terminal' | 'diff';
  value: string;
  label: string;
}
