import type { LlmUsage, ChatAttachment, LlmImagePart, LlmToolSchema } from '@shared/types';
import type { AgentSession, ChatEntry, ToolCallMeta, ToolCallState } from '../../types';
import { cleanErrorMessage, him } from '../bridge';
import { estimateTokens, relativeTo, uid } from '../utils';
import { resolveCapabilities } from '../modelCaps';
import type { ModelOption, AppConfig } from '@shared/types';
import { getAgentHost } from './host';
import { cancelApproval, resolveApproval, waitForApproval } from './approvals';
import { runAcpTurn } from './acpRuntime';
import { resolveImageParts } from './attachments';
import { loadMcpTools } from '../mcp';
import { detectPlanArtifact, expandPromptMentions, summarizeSessionLocally } from './context';
import { parseFallbackToolCalls } from './fallback';
import { streamChat } from './llmClient';
import { buildApiMessages, buildSystemPrompt } from './prompts';
import { ThinkTagParser } from './thinking';
import {
  approvalPolicy,
  describeToolCall,
  executeTool,
  isDestructiveCommand,
  toolsForPermission,
} from './tools';

interface ActiveRun {
  controller: AbortController;
  stopped: boolean;
}

interface QueuedPrompt {
  text: string;
  media?: ChatAttachment[];
}

const activeRuns = new Map<string, ActiveRun>();
const pendingPrompts = new Map<string, QueuedPrompt[]>();
const sessionGrants = new Map<string, Set<string>>();
const MAX_QUEUED_PROMPTS = 8;

/**
 * Session-scoped "always allow" grants. Destructive shell commands are never
 * grandfathered in: they keep asking even when the tool was granted.
 */
function hasGrant(sessionId: string, name: string, args: Record<string, unknown>): boolean {
  const grants = sessionGrants.get(sessionId);
  if (!grants?.has(name)) return false;
  if (name === 'run_terminal_command') {
    const command = typeof args.command === 'string' ? args.command : '';
    if (isDestructiveCommand(command)) return false;
  }
  return true;
}

function addGrant(sessionId: string, name: string): void {
  const grants = sessionGrants.get(sessionId) || new Set<string>();
  grants.add(name);
  sessionGrants.set(sessionId, grants);
}

function enqueuePrompt(sessionId: string, text: string, media?: ChatAttachment[]): void {
  const queue = pendingPrompts.get(sessionId) || [];
  if (queue.length >= MAX_QUEUED_PROMPTS) {
    getAgentHost().notify('info', `Up to ${MAX_QUEUED_PROMPTS} follow-ups can wait in the queue.`, 'Queue is full');
    return;
  }
  queue.push({ text, media });
  pendingPrompts.set(sessionId, queue);
  getAgentHost().notify(
    'info',
    `${queue.length} message${queue.length === 1 ? '' : 's'} queued. They will be sent when this turn finishes.`,
    'Queued',
  );
}

function clearQueue(sessionId: string): void {
  pendingPrompts.delete(sessionId);
}

function drainQueue(sessionId: string): void {
  const queue = pendingPrompts.get(sessionId);
  if (!queue || queue.length === 0) {
    pendingPrompts.delete(sessionId);
    return;
  }
  const session = getSession(sessionId);
  if (!session || session.status === 'stopped' || session.status === 'error') {
    pendingPrompts.delete(sessionId);
    return;
  }
  const next = queue.shift();
  if (queue.length === 0) pendingPrompts.delete(sessionId);
  if (!next) return;
  void sendPrompt(sessionId, next.text, next.media);
}

export function queuedPromptCount(sessionId: string): number {
  return pendingPrompts.get(sessionId)?.length ?? 0;
}

export function isAgentRunning(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function effectiveModelFor(session: AgentSession): ModelOption | null {
  return getAgentHost().resolveModel(session);
}

function getSession(sessionId: string): AgentSession | null {
  return getAgentHost().getSession(sessionId);
}

export function stopAgent(sessionId: string): void {
  const run = activeRuns.get(sessionId);
  const session = getSession(sessionId);
  const queued = queuedPromptCount(sessionId);
  clearQueue(sessionId);
  sessionGrants.delete(sessionId);
  if (run) {
    run.stopped = true;
    run.controller.abort();
  }
  if (session?.backend === 'acp') void him.acp.cancel(sessionId);
  cancelApproval(sessionId);
  const host = getAgentHost();
  host.setPendingApproval(sessionId, null);
  if (session && (session.status === 'running' || session.status === 'waiting')) {
    host.setStatus(sessionId, 'stopped');
  }
  if (queued > 0) {
    getAgentHost().notify('info', `Dropped ${queued} queued follow-up${queued === 1 ? '' : 's'}.`, 'Agent stopped');
  }
  if (!run && session?.status === 'waiting') {
    getAgentHost().notify('info', 'Approval cancelled.', 'Agent stopped');
  }
}

export function respondApproval(
  sessionId: string,
  allow: boolean,
  always = false,
): boolean {
  return resolveApproval(sessionId, allow, always);
}

export function compactAgent(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  if (activeRuns.has(sessionId) || session.status === 'running' || session.status === 'waiting') {
    getAgentHost().notify('info', 'Stop the agent before compacting this conversation.');
    return false;
  }
  const conversational = session.messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      !message.streaming &&
      (!message.toolCalls || message.toolCalls.length === 0),
  );
  if (conversational.length < 4) {
    getAgentHost().notify('info', 'This conversation is already compact.');
    return false;
  }
  const kept = conversational.slice(-4);
  const summaryEntry: ChatEntry = {
    id: uid('msg'),
    role: 'system',
    content: summarizeSessionLocally(session),
    createdAt: Date.now(),
    compactionNote: true,
  };
  getAgentHost().updateSession(sessionId, (current) => ({
    ...current,
    messages: [summaryEntry, ...kept],
  }));
  getAgentHost().notify('success', 'Earlier turns were summarized locally. Files and artifacts are unchanged.', 'Conversation compacted');
  return true;
}

function parseArgs(argumentsText: string): Record<string, unknown> {
  const trimmed = argumentsText.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Tool arguments are not valid JSON. Received: ${trimmed.slice(0, 240)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const IMAGE_TOKEN_COST = 850;

function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === 'image_url') total += IMAGE_TOKEN_COST * 4;
    else if (typeof record.text === 'string') total += record.text.length;
    else total += 64;
  }
  return total;
}

function entryPromptChars(entry: ChatEntry): number {
  const text = ((entry.apiContent || entry.content) || '').length;
  const media = (entry.media?.length || 0) * IMAGE_TOKEN_COST * 4;
  const calls = entry.toolCalls ? JSON.stringify(entry.toolCalls).length : 0;
  const reasoning = (entry.reasoning || '').length;
  return text + media + calls + reasoning;
}

/**
 * Keeps long conversations inside the selected model's context window by
 * summarizing older turns locally (no extra model call, no data leaves the app).
 */
function autoCompactIfNeeded(sessionId: string, model: ModelOption, force = false): void {
  const session = getSession(sessionId);
  if (!session) return;
  const window = resolveCapabilities(model.model.id, model.model.capabilities).contextWindow;
  const used = session.messages.reduce((total, entry) => total + entryPromptChars(entry), 0) + 4_000;
  const budget = Math.max(8_000, Math.floor(window * 0.75));
  if (!force && used <= budget) return;
  const conversational = session.messages.filter(
    (entry) => entry.role === 'user' || (entry.role === 'assistant' && !entry.streaming),
  );
  if (conversational.length < (force ? 3 : 6)) return;
  const keep = session.messages.slice(force ? -5 : -8);
  const summaryEntry: ChatEntry = {
    id: uid('msg'),
    role: 'system',
    content: summarizeSessionLocally(session),
    createdAt: Date.now(),
    compactionNote: true,
  };
  getAgentHost().updateSession(sessionId, (current) => ({
    ...current,
    messages: [summaryEntry, ...keep],
  }));
  getAgentHost().notify(
    'info',
    `Long conversation compacted to stay inside the ${Math.round(window / 1000)}k-token context window.`,
    'Context auto-compacted',
  );
}

function isContextLimitError(message: string): boolean {
  return /context (window|length)|maximum context|too many tokens|prompt is too long|request is too large|exceeds? the (maximum|context)|reduce the length|input token limit/i.test(
    message,
  );
}

function estimateUsage(
  messages: { content: unknown }[],
  output: string,
  rawUsage?: LlmUsage,
): LlmUsage {
  const promptChars = messages.reduce((total, message) => {
    return total + contentChars(message.content);
  }, 0);
  const promptTokens = rawUsage?.promptTokens ?? estimateTokens(String(promptChars));
  const completionTokens = rawUsage?.completionTokens ?? estimateTokens(output);
  return {
    promptTokens,
    completionTokens,
    totalTokens: rawUsage?.totalTokens ?? promptTokens + completionTokens,
    cost: rawUsage?.cost,
    estimated:
      rawUsage?.promptTokens === undefined ||
      rawUsage?.completionTokens === undefined ||
      rawUsage?.estimated,
  };
}

function toolStateFromCall(
  call: { id: string; name: string; arguments: string },
  native: boolean,
  meta: ToolCallMeta,
): ToolCallState {
  return {
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    parsedArgs: {},
    native,
    status: 'queued',
    meta,
  };
}

function appendToolResult(
  sessionId: string,
  call: { id: string; name: string },
  content: string,
  isError: boolean,
): void {
  getAgentHost().appendMessage(sessionId, {
    id: uid('msg'),
    role: 'tool',
    content,
    toolCallId: call.id,
    toolName: call.name,
    createdAt: Date.now(),
    error: isError ? content : undefined,
  });
}

export async function sendPrompt(
  sessionId: string,
  rawText: string,
  media: ChatAttachment[] = [],
): Promise<void> {
  const store = getAgentHost();
  const initial = getSession(sessionId);
  if (!initial) return;
  const trimmedRaw = rawText.trim();
  if (!trimmedRaw && media.length === 0) return;
  const attachments = media.length > 0 ? media : undefined;
  if (activeRuns.has(sessionId) || initial.status === 'running' || initial.status === 'waiting') {
    if (trimmedRaw.startsWith('/')) {
      getAgentHost().notify(
        'info',
        'Stop the agent before running conversation commands such as /compact or /clear.',
        'Agent busy',
      );
      return;
    }
    enqueuePrompt(sessionId, trimmedRaw, attachments);
    return;
  }
  let text = trimmedRaw || 'Describe and analyze the attached image.';
  if (!text) return;

  if (/^\/clear\b/i.test(text)) {
    store.resetConversation(sessionId);
    getAgentHost().notify('success', 'Conversation history cleared. Files on disk were not reverted.', 'Cleared');
    return;
  }
  if (/^\/compact\b/i.test(text)) {
    compactAgent(sessionId);
    return;
  }
  if (/^\/plan\b/i.test(text)) {
    const remainder = text.replace(/^\/plan\b/i, '').trim();
    store.setPermission(sessionId, 'plan');
    text =
      remainder ||
      'Analyze the current workspace, identify the most valuable implementation work, and produce a structured implementation plan. Do not edit files.';
    getAgentHost().notify('info', 'Plan mode is read-only. The agent will produce an implementation plan artifact.', 'Plan mode');
  }
  if (text.startsWith('/') && !/^\/plan\b/i.test(text)) {
    const command = text.split(/\s/)[0];
    if (['/compact', '/clear'].includes(command)) return;
  }

  const refreshed = getSession(sessionId) || initial;
  if (!refreshed.workspaceRoot) {
    getAgentHost().notify('error', 'Open a workspace before starting an agent.', 'No workspace');
    return;
  }

  if (refreshed.backend === 'acp') {
    const profile = (getAgentHost().getConfig() as AppConfig | null)?.acpAgents.find(
      (item) => item.id === refreshed.acpProfileId,
    );
    if (!profile || !profile.enabled || !profile.command.trim()) {
      getAgentHost().requestSettings();
      getAgentHost().notify(
        'error',
        'This ACP profile is missing, disabled, or has no command. Recreate it in Settings → Integrations.',
        'ACP profile unavailable',
      );
      return;
    }
    const controller = new AbortController();
    const run: ActiveRun = { controller, stopped: false };
    activeRuns.set(sessionId, run);
    store.setStatus(sessionId, 'running');
    store.setPendingApproval(sessionId, null);
    store.maybeTitle(sessionId, text);
    try {
      const expanded = await expandPromptMentions(text, refreshed);
      getAgentHost().appendMessage(sessionId, {
        id: uid('msg'),
        role: 'user',
        content: text,
        apiContent: expanded.apiContent,
        attachments: expanded.attachments,
        media: attachments,
        createdAt: Date.now(),
      });
      const attachmentNote =
        media.length > 0
          ? `\n\n<attachments>\n${media
              .map((item) => `- ${item.kind}: ${item.name} (${(item.size / 1024).toFixed(0)} KB)`)
              .join('\n')}\n</attachments>`
          : '';
      await runAcpTurn({
        session: getSession(sessionId) || refreshed,
        profile,
        prompt:
          (expanded.attachments.length > 0 ? expanded.apiContent : text) + attachmentNote,
        media,
        shouldStop: () => run.stopped,
      });
    } catch (error) {
      const message = cleanErrorMessage(error);
      if (!run.stopped) {
        getAgentHost().setStatus(sessionId, 'error', message);
        getAgentHost().notify('error', message, 'ACP agent failed');
      }
    } finally {
      activeRuns.delete(sessionId);
      getAgentHost().setPendingApproval(sessionId, null);
      if (run.stopped) clearQueue(sessionId);
      else drainQueue(sessionId);
    }
    return;
  }

  const model = effectiveModelFor(refreshed);
  if (!model) {
    getAgentHost().requestSettings();
    getAgentHost().notify('error', 'Connect a provider and enable at least one model to run an agent.', 'No model enabled');
    return;
  }
  if (!model.provider.baseUrl.trim()) {
    getAgentHost().requestSettings();
    getAgentHost().notify('error', `Provider "${model.provider.name}" has no base URL.`, 'Provider not configured');
    return;
  }

  const controller = new AbortController();
  const run: ActiveRun = { controller, stopped: false };
  activeRuns.set(sessionId, run);
  store.setStatus(sessionId, 'running');
  store.setPendingApproval(sessionId, null);
  store.maybeTitle(sessionId, text);

  try {
    const current = getSession(sessionId);
    if (!current) return;
    const expanded = await expandPromptMentions(text, current);
    getAgentHost().appendMessage(sessionId, {
      id: uid('msg'),
      role: 'user',
      content: text,
      apiContent: expanded.apiContent,
      attachments: expanded.attachments,
      media: attachments,
      createdAt: Date.now(),
    });
    await runAgentLoop(sessionId, run, model);
  } catch (error) {
    const message = cleanErrorMessage(error);
    const current = getSession(sessionId);
    const streamingMessage = current?.messages
      .filter((entry) => entry.role === 'assistant' && entry.streaming)
      .pop();
    if (streamingMessage) {
      getAgentHost().patchMessage(sessionId, streamingMessage.id, {
        streaming: false,
        error: run.stopped ? undefined : message,
      });
    }
    getAgentHost().setStatus(
      sessionId,
      run.stopped ? 'stopped' : 'error',
      run.stopped ? undefined : message,
    );
    if (!run.stopped) getAgentHost().notify('error', message, 'Agent failed');
  } finally {
    const current = getSession(sessionId);
    if (current?.pendingApproval) {
      const pending = current.pendingApproval;
      getAgentHost().setToolCall(sessionId, pending.messageId, pending.toolCallId, {
        status: 'rejected',
        result: 'Stopped by the user.',
      });
    }
    for (const entry of current?.messages || []) {
      if (entry.role === 'assistant' && entry.streaming) {
        getAgentHost().patchMessage(sessionId, entry.id, { streaming: false });
      }
      if (entry.role === 'assistant') {
        for (const call of entry.toolCalls || []) {
          if (call.status === 'waiting' || call.status === 'running') {
            getAgentHost().setToolCall(sessionId, entry.id, call.id, {
              status: 'rejected',
              result: 'Stopped by the user.',
            });
          }
        }
      }
    }
    activeRuns.delete(sessionId);
    cancelApproval(sessionId);
    getAgentHost().setPendingApproval(sessionId, null);
    if (run.stopped) clearQueue(sessionId);
    else drainQueue(sessionId);
  }
}

function pickFallbackModel(current: ModelOption): ModelOption | null {
  const host = getAgentHost();
  for (const kind of ['primary', 'fast', 'planning'] as const) {
    const option = host.resolveModelByKind(kind);
    if (!option) continue;
    if (option.provider.id === current.provider.id && option.model.id === current.model.id) {
      continue;
    }
    if (!option.provider.baseUrl.trim()) continue;
    return option;
  }
  return null;
}

async function runAgentLoop(
  sessionId: string,
  run: ActiveRun,
  model: ModelOption,
): Promise<void> {
  let finalAssistantId: string | null = null;
  let lastAssistantMessage: ChatEntry | null = null;
  let rounds = 0;
  const MAX_ROUNDS = 200;
  let autoContinues = 0;
  let contextRetries = 0;
  let lengthRetries = 0;
  let activeModel = model;
  let fellBack = false;

  // Keep the request inside the model's context window before the first round.
  autoCompactIfNeeded(sessionId, model);
  const prepared = getSession(sessionId);
  const imageParts = prepared ? await resolveImageParts(prepared.messages) : new Map<string, LlmImagePart[]>();

  while (!run.stopped) {
    if (rounds >= MAX_ROUNDS) {
      if (autoContinues < 2) {
        autoContinues += 1;
        rounds = 0;
        autoCompactIfNeeded(sessionId, activeModel, true);
        getAgentHost().appendMessage(sessionId, {
          id: uid('msg'),
          role: 'user',
          content:
            'Continue the task from exactly where you stopped. You were interrupted by an internal round limit. Do not repeat completed work; keep going until the task is genuinely finished.',
          createdAt: Date.now(),
        });
        getAgentHost().notify(
          'info',
          'Continuing automatically after the tool-round limit.',
          'Auto-continue',
        );
      } else {
        getAgentHost().notify(
          'info',
          'Paused after several auto-continuations. Send a follow-up message to keep going.',
          'Round limit',
        );
        break;
      }
    }
    rounds += 1;
    // Keep the working set inside the context window for very long turns.
    autoCompactIfNeeded(sessionId, activeModel);
    const session = getSession(sessionId);
    if (!session) return;

    // One host read replaces four store reads: workspace files, the root gate,
    // the open-tab list and the active file. The host returns raw paths and the
    // loop relativises them, so both hosts share one implementation of the rule.
    const workspace = getAgentHost().getWorkspaceContext(session.workspaceRoot);
    const openTabs = workspace.openTabs.map((tab) =>
      relativeTo(session.workspaceRoot, tab),
    );
    const systemPrompt = buildSystemPrompt({
      workspaceRoot: session.workspaceRoot,
      permission: session.permission,
      branch: session.worktree?.branch || session.branch || workspace.branch || null,
      worktree: session.worktree,
      files: workspace.files,
      openTabs,
      platform: workspace.platform,
      activeFile: workspace.activeFile
        ? relativeTo(session.workspaceRoot, workspace.activeFile)
        : null,
    });
    const localTools = toolsForPermission(session.permission);
    const mcpTools: LlmToolSchema[] =
      session.permission === 'plan' ? [] : await loadMcpTools(session.workspaceRoot);
    const tools = [...localTools, ...mcpTools];
    const apiMessages = buildApiMessages(systemPrompt, session.messages, imageParts);

    const assistantId = uid('msg');
    finalAssistantId = assistantId;
    getAgentHost().appendMessage(sessionId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      reasoning: '',
      toolCalls: [],
      nativeToolCalls: true,
      createdAt: Date.now(),
      streaming: true,
    });

    const parser = new ThinkTagParser();
    let liveContent = '';
    let liveReasoning = '';
    let lastFlush = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      lastFlush = Date.now();
      getAgentHost().patchMessage(sessionId, assistantId, {
        content: liveContent,
        reasoning: liveReasoning,
        streaming: true,
      });
    };
    const scheduleFlush = () => {
      const now = Date.now();
      if (now - lastFlush > 55) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flush();
        }, 55);
      }
    };

    let result: Awaited<ReturnType<typeof streamChat>> | null = null;
    try {
      result = await streamChat({
        baseUrl: activeModel.provider.baseUrl,
        apiKey: activeModel.provider.apiKey,
        headers: activeModel.provider.headers,
        model: activeModel.model.id,
        messages: apiMessages,
        tools,
        signal: run.controller.signal,
        onContentDelta: (text) => {
          for (const part of parser.push(text)) {
            if (part.kind === 'reasoning') liveReasoning += part.text;
            else liveContent += part.text;
          }
          scheduleFlush();
        },
        onReasoningDelta: (text) => {
          liveReasoning += text;
          scheduleFlush();
        },
      });
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const errorText = (error as Error)?.message || String(error);
      if (
        !aborted &&
        !run.stopped &&
        isContextLimitError(errorText) &&
        contextRetries < 3
      ) {
        contextRetries += 1;
        getAgentHost().removeMessage(sessionId, assistantId);
        autoCompactIfNeeded(sessionId, activeModel, true);
        getAgentHost().notify(
          'info',
          'The provider context window was reached. Older turns were compacted and the turn resumed.',
          'Context compacted',
        );
        rounds -= 1;
        continue;
      }
      if (!fellBack && !aborted && !run.stopped && rounds === 1) {
        const fallbackModel = pickFallbackModel(activeModel);
        if (fallbackModel) {
          fellBack = true;
          activeModel = fallbackModel;
          getAgentHost().removeMessage(sessionId, assistantId);
          getAgentHost().notify(
            'info',
            `${model.model.id} failed — retrying with ${fallbackModel.provider.name} · ${fallbackModel.model.id}.`,
            'Switching model',
          );
          rounds -= 1;
          continue;
        }
      }
      throw error;
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!result) throw new Error('The provider returned no stream.');

    for (const part of parser.finish()) {
      if (part.kind === 'reasoning') liveReasoning += part.text;
      else liveContent += part.text;
    }

    let nativeCalls = result.toolCalls;
    let native = nativeCalls.length > 0;
    let fallbackApiContent: string | undefined;
    if (nativeCalls.length === 0) {
      const fallback = parseFallbackToolCalls(liveContent);
      if (fallback.calls.length > 0) {
        nativeCalls = fallback.calls;
        fallbackApiContent = [fallback.cleaned, ...fallback.rawBlocks]
          .filter(Boolean)
          .join('\n\n');
        liveContent = fallback.cleaned;
        native = false;
      }
    }

    const uniqueIds = new Set<string>();
    const calls = nativeCalls.map((call) => {
      let id = call.id;
      while (!id || uniqueIds.has(id)) id = uid('call');
      uniqueIds.add(id);
      return { ...call, id };
    });

    let toolStates: ToolCallState[] = [];
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      let meta: ToolCallMeta = { path: call.name };
      try {
        args = parseArgs(call.arguments);
        meta = describeToolCall(call.name, args);
      } catch {
        meta = {};
      }
      toolStates.push(toolStateFromCall(call, native, meta));
    }

    const usage = estimateUsage(
      apiMessages,
      `${liveContent}\n${liveReasoning}`,
      result.usage,
    );
    const patch: Partial<ChatEntry> = {
      content: liveContent,
      apiContent: fallbackApiContent,
      reasoning: liveReasoning.trim(),
      toolCalls: toolStates,
      nativeToolCalls: native,
      streaming: false,
      usage,
    };
    getAgentHost().patchMessage(sessionId, assistantId, patch);
    getAgentHost().addUsage(sessionId, {
      input: usage.promptTokens || 0,
      output: usage.completionTokens || 0,
      cost: usage.cost,
      estimated: usage.estimated,
    });
    lastAssistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: liveContent,
      reasoning: liveReasoning,
      toolCalls: toolStates,
      nativeToolCalls: native,
      createdAt: Date.now(),
      usage,
    };

    if (run.stopped) break;
    if (calls.length === 0) {
      if (!liveContent.trim() && !liveReasoning.trim()) {
        getAgentHost().patchMessage(sessionId, assistantId, {
          error: 'The model returned an empty response.',
        });
        getAgentHost().setStatus(sessionId, 'error', 'The model returned an empty response.');
        getAgentHost().notify('error', 'The model returned no content and no tool calls.', 'Empty response');
        return;
      }
      if (result.finishReason === 'length' && lengthRetries < 3) {
        lengthRetries += 1;
        getAgentHost().appendMessage(sessionId, {
          id: uid('msg'),
          role: 'user',
          content:
            'Your previous response was cut off by the output token limit. Continue exactly where you stopped. Do not repeat completed work and keep the next response concise.',
          createdAt: Date.now(),
        });
        continue;
      }
      break;
    }

    for (let index = 0; index < calls.length; index += 1) {
      if (run.stopped) break;
      const call = calls[index];
      let args: Record<string, unknown>;
      try {
        args = parseArgs(call.arguments);
      } catch (error) {
        getAgentHost().setToolCall(sessionId, assistantId, call.id, {
          status: 'error',
          error: (error as Error).message,
          result: `Invalid arguments: ${(error as Error).message}`,
        });
        appendToolResult(sessionId, call, `Error: ${(error as Error).message}`, true);
        continue;
      }
      const meta = describeToolCall(call.name, args);
      getAgentHost().setToolCall(sessionId, assistantId, call.id, {
        parsedArgs: args,
        meta,
      });

      const current = getSession(sessionId);
      if (!current) return;
      const policy = approvalPolicy(current.permission, call.name, args);
      if (policy === 'deny') {
        const reason = `Tool "${call.name}" is disabled in ${current.permission} mode. Continue without it or finish with an explanation.`;
        getAgentHost().setToolCall(sessionId, assistantId, call.id, {
          status: 'rejected',
          result: reason,
        });
        appendToolResult(sessionId, call, reason, true);
        continue;
      }

      if (policy === 'ask' && !hasGrant(sessionId, call.name, args)) {
        getAgentHost().setPendingApproval(sessionId, {
          messageId: assistantId,
          toolCallId: call.id,
        });
        getAgentHost().setStatus(sessionId, 'waiting');
        getAgentHost().setToolCall(sessionId, assistantId, call.id, {
          status: 'waiting',
        });
        const decision = await waitForApproval(sessionId);
        getAgentHost().setPendingApproval(sessionId, null);
        if (run.stopped) break;
        if (!decision.allow) {
          const reason =
            'The user rejected this tool call. Do not retry it unchanged; propose an alternative or ask what they prefer.';
          getAgentHost().setToolCall(sessionId, assistantId, call.id, {
            status: 'rejected',
            result: reason,
          });
          appendToolResult(sessionId, call, reason, true);
          getAgentHost().setStatus(sessionId, 'running');
          continue;
        }
        if (decision.always) {
          addGrant(sessionId, call.name);
        }
      }

      getAgentHost().setStatus(sessionId, 'running');
      getAgentHost().setToolCall(sessionId, assistantId, call.id, {
        status: 'running',
        startedAt: Date.now(),
      });
      const sessionNow = getSession(sessionId);
      if (!sessionNow) return;
      try {
        const execution = await executeTool({
          session: sessionNow,
          name: call.name,
          args,
          signal: run.controller.signal,
        });
        getAgentHost().setToolCall(sessionId, assistantId, call.id, {
          status: 'done',
          result: execution.output,
          meta: { ...meta, ...execution.meta },
          endedAt: Date.now(),
        });
        if (execution.change) {
          getAgentHost().addChange(sessionId, {
            path: execution.change.path,
            absPath: execution.change.absPath,
            before: execution.change.before,
            after: execution.change.after,
            status: 'pending',
            kind: execution.change.before.trim() ? 'modified' : 'added',
            added: execution.change.added,
            removed: execution.change.removed,
            updatedAt: Date.now(),
          });
        }
        appendToolResult(sessionId, call, execution.output, execution.isError);
      } catch (error) {
        if (run.stopped || (error as Error).name === 'AbortError') break;
        const message = cleanErrorMessage(error);
        getAgentHost().setToolCall(sessionId, assistantId, call.id, {
          status: 'error',
          error: message,
          result: `Error: ${message}`,
          endedAt: Date.now(),
        });
        appendToolResult(sessionId, call, `Error: ${message}`, true);
      }
    }
  }

  if (run.stopped) {
    getAgentHost().setStatus(sessionId, 'stopped');
    return;
  }
  if (rounds >= MAX_ROUNDS) {
    getAgentHost().notify('info', 'The agent reached the tool-round limit for one turn. Send another message to continue.', 'Round limit');
  }
  getAgentHost().setStatus(sessionId, 'completed');

  const finishedSession = getSession(sessionId);
  if (finishedSession && lastAssistantMessage) {
    const artifact = detectPlanArtifact(finishedSession, lastAssistantMessage);
    if (artifact) {
      getAgentHost().upsertArtifact(sessionId, {
        id: uid('artifact'),
        title: artifact.title,
        kind: 'plan',
        content: artifact.content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        comments: [],
      });
    }
  }
}
