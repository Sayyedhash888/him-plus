import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferModelCapabilities,
  modelSupportsVision,
  resolveCapabilities,
} from '../src/lib/modelCaps.ts';
import { buildApiMessages } from '../src/lib/agent/prompts.ts';
import { cancelApproval, resolveApproval, waitForApproval } from '../src/lib/agent/approvals.ts';
import type { ChatEntry } from '../src/types.ts';
import type { LlmImagePart } from '../shared/types.ts';

test('infers vision and context window for known multimodal models', () => {
  const gpt4o = inferModelCapabilities('gpt-4o-2024-08-06');
  assert.equal(gpt4o.vision, true);
  assert.equal(gpt4o.contextWindow, 128_000);

  const claude = inferModelCapabilities('claude-sonnet-4-5');
  assert.equal(claude.vision, true);
  assert.equal(claude.contextWindow, 200_000);

  const gemini = inferModelCapabilities('gemini-2.5-pro');
  assert.equal(gemini.vision, true);
  assert.equal(gemini.contextWindow, 1_000_000);
});

test('does not claim vision for text-only models', () => {
  assert.equal(modelSupportsVision('gpt-3.5-turbo'), false);
  assert.equal(modelSupportsVision('text-embedding-3-large'), false);
  assert.equal(inferModelCapabilities('all-minilm-embed').vision, false);
});

test('configured capabilities win over inference', () => {
  const resolved = resolveCapabilities('some-unknown-model', {
    vision: true,
    tools: false,
    contextWindow: 1234,
  });
  assert.deepEqual(resolved, { vision: true, tools: false, contextWindow: 1234 });
});

test('unknown models fall back to a conservative context window', () => {
  const resolved = resolveCapabilities('mystery-model');
  assert.equal(resolved.contextWindow, 32_768);
  assert.equal(resolved.tools, true);
});

function userEntry(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'What is wrong with this screenshot?',
    createdAt: Date.now(),
    ...overrides,
  };
}

test('buildApiMessages keeps plain text user turns as strings', () => {
  const messages = buildApiMessages('system', [userEntry()]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1], {
    role: 'user',
    content: 'What is wrong with this screenshot?',
  });
});

test('buildApiMessages injects image parts ahead of the text part', () => {
  const parts: LlmImagePart[] = [
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' } },
  ];
  const messages = buildApiMessages('system', [userEntry()], new Map([['msg-1', parts]]));
  const content = messages[1].content;
  assert.ok(Array.isArray(content));
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], {
    type: 'text',
    text: 'What is wrong with this screenshot?',
  });
  assert.deepEqual(content[1], parts[0]);
});

test('approval decisions carry the always-allow flag', async () => {
  const waiting = waitForApproval('session-a');
  assert.equal(resolveApproval('session-a', true, true), true);
  assert.deepEqual(await waiting, { allow: true, always: true });

  const rejected = waitForApproval('session-b');
  resolveApproval('session-b', false, true);
  assert.deepEqual(await rejected, { allow: false, always: false });

  const cancelled = waitForApproval('session-c');
  cancelApproval('session-c');
  assert.deepEqual(await cancelled, { allow: false, always: false });
});
