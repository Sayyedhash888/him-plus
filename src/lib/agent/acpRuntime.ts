import { diffLines } from 'diff';
import { estimateTokens } from '../cliTranscript';
import type { AcpAgentProfile, ChatAttachment } from '@shared/types';
import type { AcpSessionUpdate, AcpStreamEvent } from '@shared/acp';
import type {
  AgentSession,
  Artifact,
  ChatEntry,
  ToolCallMeta,
  ToolCallState,
} from '../../types';
import { cleanErrorMessage, him } from '../bridge';
import { relativeTo, uid } from '../utils';
import { useSessionStore } from '../../store/sessions';
import { toast } from '../../store/toast';

function textContent(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const content = value as { type?: unknown; text?: unknown };
  return content.type === 'text' && typeof content.text === 'string' ? content.text : '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toolResult(update: AcpSessionUpdate): string {
  const chunks: string[] = [];
  if (Array.isArray(update.content)) {
    for (const item of update.content) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === 'content') {
        const text = textContent(entry.content);
        if (text) chunks.push(text);
      } else if (entry.type === 'diff' && typeof entry.path === 'string') {
        chunks.push(`Updated ${entry.path}`);
      }
    }
  }
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    try {
      chunks.push(
        typeof update.rawOutput === 'string'
          ? update.rawOutput
          : JSON.stringify(update.rawOutput, null, 2),
      );
    } catch {
      // ignore
    }
  }
  return chunks.join('\n').slice(0, 24_000);
}

function toolMeta(update: AcpSessionUpdate): ToolCallMeta {
  const meta: ToolCallMeta = {};
  const locations = Array.isArray(update.locations) ? update.locations : [];
  for (const location of locations) {
    if (
      location &&
      typeof location === 'object' &&
      typeof (location as { path?: unknown }).path === 'string'
    ) {
      meta.path = (location as { path: string }).path;
      break;
    }
  }
  const raw = update.rawInput;
  if (raw && typeof raw === 'object') {
    const input = raw as Record<string, unknown>;
    if (!meta.path && typeof input.path === 'string') meta.path = input.path;
    if (typeof input.command === 'string') meta.command = input.command;
    if (typeof input.query === 'string') meta.query = input.query;
  }
  return meta;
}

function statusFor(value: unknown): ToolCallState['status'] {
  switch (value) {
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'waiting';
  }
}

function planMarkdown(update: AcpSessionUpdate): string {
  const entries = Array.isArray(update.entries) ? update.entries : [];
  const lines = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const item = entry as Record<string, unknown>;
      const done = item.status === 'completed';
      const content = stringValue(item.content);
      return content ? `- [${done ? 'x' : ' '}] ${content}` : '';
    })
    .filter(Boolean);
  return lines.join('\n');
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length;
}

function enrichAcpError(message: string, profile: AcpAgentProfile): string {
  if (/api key|unauthorized|authentication|auth required|401|403|credential/i.test(message)) {
    return `${message}\n\nThis error was reported by the external ACP agent (${profile.name}) itself — HIM+ does not manage its provider credentials. Fix the agent's own auth/configuration (for OpenCode run "opencode auth login" or correct its opencode.json providers), then retry.`;
  }
  return message;
}

function changeStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const count = part.count || countLines(part.value);
    if (part.added) added += count;
    if (part.removed) removed += count;
  }
  return { added, removed };
}

export async function runAcpTurn(input: {
  session: AgentSession;
  profile: AcpAgentProfile;
  prompt: string;
  media?: ChatAttachment[];
  shouldStop(): boolean;
}): Promise<void> {
  const { session, profile, prompt, media, shouldStop } = input;
  const store = useSessionStore.getState();

  const refreshAcpModels = async () => {
    try {
      const result = await him.acp.connect({
        sessionId: session.id,
        profile,
        cwd: session.workspaceRoot,
        permission: session.permission,
      });
      if (result.ok && result.models) {
        store.setAcpModels(session.id, result.models);
      }
      if (result.ok && result.capabilities) {
        store.setAcpVision(session.id, result.capabilities.image === true);
      }
    } catch {
      // Model discovery is best-effort; the turn itself already finished.
    }
  };
  const assistantId = uid('msg');
  const tools = new Map<string, ToolCallState>();
  let content = '';
  let reasoning = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let estimatedOutputTokens = 0;

  store.appendMessage(session.id, {
    id: assistantId,
    role: 'assistant',
    content: '',
    reasoning: '',
    toolCalls: [],
    nativeToolCalls: true,
    createdAt: Date.now(),
    streaming: true,
  });
  // ACP agents rarely report usage, so start with a prompt estimate and add
  // streamed output estimates as they arrive; real usage (when present) tops up.
  store.addUsage(session.id, {
    input: estimateTokens(prompt),
    output: 0,
    estimated: true,
  });

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    store.patchMessage(session.id, assistantId, {
      content,
      reasoning,
      toolCalls: [...tools.values()],
      streaming: true,
    });
    const estimate = estimateTokens(`${content}${reasoning}`);
    const delta = Math.max(0, estimate - estimatedOutputTokens);
    if (delta > 0) {
      estimatedOutputTokens = estimate;
      store.addUsage(session.id, { input: 0, output: delta, estimated: true });
    }
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 45);
  };

  const handleUpdate = (update: AcpSessionUpdate) => {
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk') {
      const text = textContent(update.content);
      if (text) {
        content += text;
        scheduleFlush();
      }
      return;
    }
    if (kind === 'agent_thought_chunk') {
      const text = textContent(update.content);
      if (text) {
        reasoning += text;
        scheduleFlush();
      }
      return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const callId = stringValue(update.toolCallId);
      if (!callId) return;
      const existing = tools.get(callId);
      const raw = update.rawInput;
      const parsedArgs =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : existing?.parsedArgs || {};
      const result = toolResult(update);
      const next: ToolCallState = {
        id: callId,
        name: stringValue(update.name) || stringValue(update.title) || existing?.name || 'acp_tool',
        arguments:
          raw === undefined
            ? existing?.arguments || '{}'
            : (() => {
                try {
                  return JSON.stringify(raw);
                } catch {
                  return existing?.arguments || '{}';
                }
              })(),
        parsedArgs,
        native: true,
        status: update.status ? statusFor(update.status) : existing?.status || 'waiting',
        result: result || existing?.result,
        meta: { ...existing?.meta, ...toolMeta(update) },
        startedAt: existing?.startedAt || (update.status ? Date.now() : undefined),
        endedAt:
          update.status === 'completed' || update.status === 'failed'
            ? Date.now()
            : existing?.endedAt,
      };
      tools.set(callId, next);
      flush();
      return;
    }
    if (kind === 'plan') {
      const markdown = planMarkdown(update);
      if (!markdown) return;
      const artifact: Artifact = {
        id: uid('artifact'),
        title: 'Implementation plan',
        kind: 'plan',
        content: markdown,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        comments: [],
      };
      store.upsertArtifact(session.id, artifact);
      return;
    }
  };

  let failure = '';
  let cancelled = false;
  let resolveDone: (reason: string) => void = () => {};
  const donePromise = new Promise<string>((resolve) => {
    resolveDone = resolve;
  });

  const handleEvent = (event: AcpStreamEvent) => {
    if (event.sessionId !== session.id) return;
    if (event.type === 'update') {
      handleUpdate(event.update);
      return;
    }
    if (event.type === 'done') {
      resolveDone(event.stopReason || 'end_turn');
      return;
    }
    if (event.type === 'error') {
      failure = event.message || 'The ACP agent failed.';
      return;
    }
    if (event.type === 'file') {
      const change = event.change;
      if (change.before === change.after) return;
      const stats = changeStats(change.before, change.after);
      store.addChange(session.id, {
        path: relativeTo(session.workspaceRoot, change.path),
        absPath: change.path,
        before: change.before,
        after: change.after,
        status: 'pending',
        kind: change.before.trim() ? 'modified' : 'added',
        added: stats.added,
        removed: stats.removed,
        updatedAt: Date.now(),
      });
      flush();
    }
  };

  const unsubscribe = him.acp.onEvent(handleEvent);
  try {
    const result = await him.acp.prompt({
      sessionId: session.id,
      profile,
      cwd: session.workspaceRoot,
      permission: session.permission,
      prompt,
      media: (media || [])
        .filter((item) => item.kind === 'image')
        .map((item) => ({
          kind: 'image' as const,
          name: item.name,
          mime: item.mime,
          path: item.path,
        })),
    });
    if (result.warning) {
      toast('info', result.warning, 'ACP images');
    }
    if (!result.ok) {
      if (!shouldStop()) failure = enrichAcpError(result.error || 'The ACP agent failed.', profile);
    } else {
      if (result.usage) {
        const actualInput = result.usage.inputTokens ?? 0;
        const actualOutput = result.usage.outputTokens ?? 0;
        const topUpInput = Math.max(0, actualInput - estimateTokens(prompt));
        const topUpOutput = Math.max(0, actualOutput - estimatedOutputTokens);
        if (topUpInput > 0 || topUpOutput > 0) {
          store.addUsage(session.id, {
            input: topUpInput,
            output: topUpOutput,
            estimated: true,
          });
        }
      }
      // Final session/update notifications are delivered on the event channel.
      // Wait for the main process's terminal "done" event so trailing message
      // chunks cannot be lost when the invoke response wins the IPC race.
      const timeout = new Promise<string | null>((resolve) => {
        setTimeout(() => resolve(null), 750);
      });
      const streamedReason = await Promise.race([donePromise, timeout]);
      const stopReason = streamedReason || result.stopReason || 'end_turn';
      cancelled = stopReason === 'cancelled';
    }
  } catch (error) {
    if (!shouldStop()) failure = enrichAcpError(cleanErrorMessage(error), profile);
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    unsubscribe();
    for (const [id, call] of tools) {
      if (call.status === 'running' || call.status === 'waiting') {
        tools.set(id, {
          ...call,
          status: failure || shouldStop() ? 'error' : 'done',
          result:
            call.result ||
            (failure
              ? `Interrupted: ${failure}`
              : shouldStop()
                ? 'Stopped by the user.'
                : 'Finished.'),
          endedAt: Date.now(),
        });
      }
    }
    const stopped = shouldStop();
    store.patchMessage(session.id, assistantId, {
      content,
      reasoning,
      toolCalls: [...tools.values()],
      streaming: false,
      error: failure || undefined,
    });
    if (stopped || cancelled) {
      store.setStatus(session.id, 'stopped');
    } else if (failure) {
      store.setStatus(session.id, 'error', failure);
      toast('error', failure, 'ACP agent failed');
    } else {
      store.setStatus(session.id, 'completed');
      void refreshAcpModels();
    }
  }
}