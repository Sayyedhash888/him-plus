import * as vscode from 'vscode';
import path from 'node:path';
import {
  chatCompletionsUrl,
  requestHeaders,
  resolveHimModel,
  resolveHimRuntime,
  type HimModelRef,
  type ResolvedHimModel,
} from './himConfig';

export interface HimChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

interface ApiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ApiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ApiToolCall[];
    };
  }>;
  error?: { message?: string } | string;
}

export type AgentEvent =
  | { type: 'tool'; name: string; detail: string }
  | { type: 'assistant'; content: string };

/**
 * Hooks supplied by the extension host so the model can delegate work to
 * background helper agents (Herdr-style). Methods return the text shown to the
 * model; spawning must not block.
 */
export interface AgentToolContext {
  spawnSubagent?(task: string, label?: string): string;
  listSubagents?(): string;
}

const FILE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file inside the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional case-insensitive substring to filter file paths.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'active_file',
      description: 'Read the file currently open in the active editor.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const SUBAGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description:
        'Start a background helper agent on an independent read-only task (research, scan, review). Returns immediately; results are reported back into this chat when the helper finishes.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'A self-contained task for the helper agent, including all context it needs.',
          },
          label: { type: 'string', description: 'Optional short label, e.g. "find TODOs".' },
        },
        required: ['task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_subagents',
      description: 'List background helper agents and their status/results in this session.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function toolDefinitions(includeSubagents: boolean): unknown[] {
  return includeSubagents ? [...FILE_TOOLS, ...SUBAGENT_TOOLS] : FILE_TOOLS;
}

function workspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function insideWorkspace(root: string, requested: string): string {
  const absolute = path.isAbsolute(requested)
    ? path.normalize(requested)
    : path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the workspace: ${requested}`);
  }
  return absolute;
}

async function readWorkspaceFile(relativePath: string): Promise<string> {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder is open.');
  const absolute = insideWorkspace(root, relativePath);
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolute));
  const text = new TextDecoder().decode(bytes);
  if (text.includes('\u0000')) throw new Error('That file appears to be binary.');
  return text.length > 60_000
    ? `${text.slice(0, 60_000)}\n\n[truncated at 60,000 characters]`
    : text;
}

async function listWorkspaceFiles(query = ''): Promise<string> {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder is open.');
  const files = await vscode.workspace.findFiles(
    '**/*',
    '**/{node_modules,.git,dist,dist-electron,release,out,coverage}/**',
    400,
  );
  const filter = query.trim().toLowerCase();
  return files
    .map((uri) => path.relative(root, uri.fsPath).replaceAll('\\', '/'))
    .filter((file) => !filter || file.toLowerCase().includes(filter))
    .sort()
    .slice(0, 250)
    .join('\n');
}

async function readActiveFile(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return 'No active editor.';
  const root = workspaceRoot();
  const relative = root
    ? path.relative(root, editor.document.uri.fsPath).replaceAll('\\', '/')
    : editor.document.fileName;
  const text = editor.document.getText();
  return `File: ${relative}\n\n${text.slice(0, 60_000)}${
    text.length > 60_000 ? '\n\n[truncated at 60,000 characters]' : ''
  }`;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: AgentToolContext,
): Promise<string> {
  if (name === 'read_file') {
    const file = typeof args.path === 'string' ? args.path : '';
    if (!file) throw new Error('read_file requires a path.');
    return readWorkspaceFile(file);
  }
  if (name === 'list_files') {
    return listWorkspaceFiles(typeof args.query === 'string' ? args.query : '');
  }
  if (name === 'active_file') return readActiveFile();
  if (name === 'spawn_subagent') {
    if (!context?.spawnSubagent) throw new Error('Subagents are not available in this context.');
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) throw new Error('spawn_subagent requires a task.');
    const label = typeof args.label === 'string' ? args.label : undefined;
    return context.spawnSubagent(task, label);
  }
  if (name === 'list_subagents') {
    return context?.listSubagents?.() || 'Subagents are not available in this context.';
  }
  throw new Error(`Unknown tool: ${name}`);
}

function systemPrompt(model: ResolvedHimModel, allowSubagents: boolean): string {
  const root = workspaceRoot() || 'No workspace';
  const active = vscode.window.activeTextEditor;
  const activePath = active
    ? path.relative(root, active.document.uri.fsPath).replaceAll('\\', '/')
    : 'none';
  return [
    'You are HIM+ Agent running inside HIM+ Code, the VS Code-compatible HIM+ editor.',
    `Workspace root: ${root}`,
    `Active editor: ${activePath}`,
    `Model: ${model.label}`,
    'You can inspect the workspace with read_file, list_files and active_file tools.',
    allowSubagents
      ? 'You can delegate independent read-only work with spawn_subagent; it runs in the background and its result is reported back into this chat. Use list_subagents to check status.'
      : 'Subagents are not available in this turn; do the work directly.',
    'Use tools when facts about the code are needed. Do not invent file contents.',
    'This extension is read-only; if a code edit is needed, explain the exact change and tell the user to apply it or use the HIM+ desktop app.',
    'Answer concisely with concrete file paths and code when useful.',
  ].join('\n');
}

async function callChat(
  model: ResolvedHimModel,
  messages: ApiMessage[],
  tools: boolean,
  signal: AbortSignal,
  includeSubagents = false,
): Promise<ApiMessage> {
  const body: Record<string, unknown> = {
    model: model.model.id,
    messages,
    temperature: 0.2,
    stream: false,
  };
  if (tools) {
    body.tools = toolDefinitions(includeSubagents);
    body.tool_choice = 'auto';
  }
  const response = await fetch(chatCompletionsUrl(model.provider.baseUrl), {
    method: 'POST',
    headers: requestHeaders(model.provider),
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text.trim().slice(0, 500)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  let json: ApiResponse;
  try {
    json = JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error('The provider returned non-JSON output.');
  }
  if (json.error) {
    throw new Error(
      typeof json.error === 'string' ? json.error : json.error.message || 'Provider error',
    );
  }
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error('The provider returned no message.');
  return {
    role: 'assistant',
    content: message.content || '',
    tool_calls: message.tool_calls,
  };
}

export async function runHimAgent(input: {
  prompt: string;
  history: HimChatMessage[];
  modelRef?: HimModelRef | null;
  signal: AbortSignal;
  onEvent(event: AgentEvent): void;
  context?: AgentToolContext;
}): Promise<string> {
  const settings = vscode.workspace.getConfiguration('him');
  const runtime = await resolveHimRuntime(
    settings.get<string>('configPath', ''),
    settings.get<string>('apiKey', ''),
  );
  if (!runtime) {
    throw new Error(
      'HIM+ configuration was not found. Launch the HIM+ desktop app once or set him.configPath.',
    );
  }
  if (runtime.keyError) throw new Error(runtime.keyError);

  const model = resolveHimModel(runtime.config, input.modelRef ?? null, 'primary');
  if (!model) {
    throw new Error(
      'No enabled HIM+ model. Enable a provider/model in the HIM+ desktop settings.',
    );
  }

  const messages: ApiMessage[] = [
    { role: 'system', content: systemPrompt(model, Boolean(input.context?.spawnSubagent)) },
    ...input.history.slice(-24).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: 'user', content: input.prompt },
  ];
  const includeSubagents = Boolean(input.context?.spawnSubagent);

  let useTools = true;
  for (let round = 0; round < 16; round += 1) {
    let reply: ApiMessage;
    try {
      reply = await callChat(model, messages, useTools, input.signal, includeSubagents);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (useTools && status === 400) {
        useTools = false;
        messages.push({
          role: 'user',
          content:
            'The provider rejected tool definitions. Answer from the information in this conversation without tools.',
        });
        reply = await callChat(model, messages, false, input.signal, false);
      } else {
        throw error;
      }
    }

    messages.push(reply);
    if (!reply.tool_calls?.length) {
      const content = (reply.content || '').trim();
      if (!content) throw new Error('The model returned an empty response.');
      input.onEvent({ type: 'assistant', content });
      return content;
    }

    for (const call of reply.tool_calls) {
      if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const name = call.function?.name || 'tool';
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const detail =
        typeof args.path === 'string'
          ? args.path
          : typeof args.query === 'string'
            ? args.query
            : name;
      input.onEvent({ type: 'tool', name, detail });
      let result: string;
      try {
        result = await executeTool(name, args, input.context);
      } catch (error) {
        result = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.slice(0, 40_000),
      });
    }
  }
  throw new Error('The agent exceeded its tool-round limit.');
}